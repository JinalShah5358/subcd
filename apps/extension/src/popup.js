/**
 * Popup: the only way anything here starts.
 *
 * Nothing in this extension runs on page load, on a timer, or in response to
 * the portal. Every capture and every fill begins with a click in this window,
 * which is what "the CA stays in control" has to mean in practice.
 */

const $ = (id) => document.getElementById(id);

const OUTCOME_LABEL = {
  FILLED: 'Filled',
  MISSING: 'Not on the page',
  NOT_EDITABLE: 'Not editable',
  NO_VALUE: 'No data on the case',
  OPTION_NOT_FOUND: 'No matching option',
  REFUSED: 'Refused by policy',
  SKIPPED: 'Preview only',
};

const OUTCOME_TONE = {
  FILLED: 'ok',
  REFUSED: 'warn',
  NO_VALUE: 'muted',
  SKIPPED: 'muted',
};

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res?.ok) {
        const err = new Error(res?.error || 'Something went wrong');
        err.code = res?.code;
        return reject(err);
      }
      resolve(res.data);
    });
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // chrome.tabs objects do not survive structured cloning intact for our
  // purposes; pass only what the worker needs.
  return tab ? { id: tab.id, url: tab.url } : null;
}

function show(view) {
  for (const id of ['view-loading', 'view-pair', 'view-main', 'view-settings']) {
    $(id).hidden = id !== view;
  }
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

/* --------------------------------- boot --------------------------------- */

let state = { me: null, tab: null, mapping: null, formCode: null };

/** The host decides which form this is — the server says which host is which. */
function formForTab() {
  const host = tabHost();
  return (state.me?.forms ?? []).find((f) => f.host.toLowerCase() === host) ?? null;
}

function tabHost() {
  try {
    return new URL(state.tab?.url ?? '').hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function boot() {
  state.tab = await activeTab();

  let status;
  try {
    status = await send('status');
  } catch (err) {
    show('view-pair');
    showError($('pair-error'), err.message);
    return;
  }

  $('pair-api').value = status.apiBase;

  if (!status.paired) {
    show('view-pair');
    if (status.error) showError($('pair-error'), status.error);
    return;
  }

  state.me = status.me;
  state.expiresAt = status.expiresAt;
  $('firm-name').textContent = status.me?.firm?.name ?? '';

  show('view-main');
  await loadMain();
}

async function loadMain() {
  const hosts = state.me?.hosts ?? [];
  const form = formForTab();
  state.formCode = form?.code ?? null;

  const onPortal = Boolean(form);
  const warn = $('host-warning');
  if (!onPortal) {
    warn.hidden = false;
    warn.textContent = `Open ${hosts.join(' or ')} in this tab. The assistant only works there.`;
    $('fill').disabled = true;
    $('preview').disabled = true;
    $('capture').disabled = true;
  } else {
    warn.hidden = true;
  }

  try {
    const cases = await send('cases');
    const select = $('case-select');
    select.innerHTML = '';
    if (!cases.length) {
      const opt = document.createElement('option');
      opt.textContent = 'No cases available';
      opt.value = '';
      select.appendChild(opt);
      $('fill').disabled = true;
      $('preview').disabled = true;
    } else {
      for (const c of cases) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.caseNumber} — ${c.clientName}`;
        opt.dataset.status = c.status;
        opt.dataset.readiness = String(c.readinessScore);
        select.appendChild(opt);
      }
      updateCaseMeta();
    }
  } catch (err) {
    showError($('main-error'), err.message);
  }

  if (!state.formCode) return;

  try {
    state.mapping = await send('mapping', { formCode: state.formCode });
    const missing = !state.mapping?.version;
    $('no-mapping').hidden = !missing;
    if (missing) {
      $('fill').disabled = true;
      $('preview').disabled = true;
    }
  } catch (err) {
    showError($('main-error'), err.message);
  }
}

function updateCaseMeta() {
  const opt = $('case-select').selectedOptions[0];
  if (!opt?.value) return ($('case-meta').textContent = '');
  const readiness = Number(opt.dataset.readiness ?? 0);
  const status = (opt.dataset.status ?? '').replace(/_/g, ' ').toLowerCase();
  $('case-meta').textContent = `${status} · ${readiness}% ready`;
  $('case-meta').className =
    readiness >= 80 ? 'muted small' : 'small warn-text';
}

/* -------------------------------- actions -------------------------------- */

function renderResults(result) {
  $('results').hidden = false;
  const list = $('result-list');
  list.innerHTML = '';

  const filled = result.outcomes.filter((o) => o.outcome === 'FILLED').length;
  const notFilled = result.outcomes.length - filled;

  $('result-summary').textContent = result.dryRun
    ? `${result.planned} field(s) would be filled`
    : `${filled} filled, ${notFilled} not`;

  // Anything that did not get filled goes first — that is what needs a human.
  const sorted = [...result.outcomes].sort((a, b) =>
    a.outcome === 'FILLED' ? 1 : b.outcome === 'FILLED' ? -1 : 0,
  );

  for (const o of sorted) {
    const li = document.createElement('li');
    li.className = OUTCOME_TONE[o.outcome] ?? 'warn';
    const path = document.createElement('code');
    path.textContent = o.sourcePath;
    const label = document.createElement('span');
    label.textContent = OUTCOME_LABEL[o.outcome] ?? o.outcome;
    li.append(path, label);
    if (o.detail) {
      const detail = document.createElement('em');
      detail.textContent = o.detail;
      li.append(detail);
    }
    list.appendChild(li);
  }

  const drift = $('drift-warning');
  drift.hidden = !result.driftDetected;
  if (result.driftDetected) {
    drift.textContent =
      'This page does not match the captured field map — the portal may have changed. Check every field carefully, then capture the page again.';
  }
}

async function run(dryRun) {
  const caseId = $('case-select').value;
  if (!caseId) return;

  showError($('main-error'), '');
  const button = dryRun ? $('preview') : $('fill');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = dryRun ? 'Checking…' : 'Filling…';

  try {
    const result = await send('fill', {
      tab: state.tab,
      caseId,
      formCode: state.formCode,
      dryRun,
    });
    renderResults(result);
  } catch (err) {
    showError($('main-error'), err.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

/* -------------------------------- wiring --------------------------------- */

$('case-select').addEventListener('change', updateCaseMeta);
$('preview').addEventListener('click', () => run(true));
$('fill').addEventListener('click', () => run(false));

$('capture').addEventListener('click', async () => {
  showError($('main-error'), '');
  const label = $('capture-label').value.trim() || `Capture ${new Date().toISOString().slice(0, 10)}`;
  const button = $('capture');
  button.disabled = true;
  button.textContent = 'Capturing…';
  try {
    const res = await send('capture', { tab: state.tab, formCode: state.formCode, label });
    showError(
      $('main-error'),
      `Captured ${res.fieldCount} control(s), ${res.refusedCount} left alone by policy. Map them in the platform, then activate.`,
    );
    $('main-error').className = 'note';
  } catch (err) {
    $('main-error').className = 'error';
    showError($('main-error'), err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Capture this page';
  }
});

$('clear-marks').addEventListener('click', async () => {
  try {
    await send('clearMarks', { tab: state.tab });
  } catch (err) {
    showError($('main-error'), err.message);
  }
});

$('pair-submit').addEventListener('click', async () => {
  showError($('pair-error'), '');
  const code = $('pair-code').value.trim();
  const label = $('pair-label').value.trim();
  const apiBase = $('pair-api').value.trim();

  if (!code) return showError($('pair-error'), 'Enter the pairing code');
  if (!label) return showError($('pair-error'), 'Give this browser a name');

  const button = $('pair-submit');
  button.disabled = true;
  try {
    await send('pair', { code, label, apiBase });
    await boot();
  } catch (err) {
    showError($('pair-error'), err.message);
  } finally {
    button.disabled = false;
  }
});

$('settings').addEventListener('click', () => {
  if (!state.me) return;
  $('set-user').textContent = state.me.user?.email ?? '—';
  $('set-firm').textContent = state.me.firm?.name ?? '—';
  $('set-hosts').textContent = (state.me.hosts ?? []).join(', ') || '—';
  $('set-expiry').textContent = state.expiresAt
    ? new Date(state.expiresAt).toLocaleDateString()
    : '—';
  show('view-settings');
});

$('settings-back').addEventListener('click', () => show('view-main'));

$('unpair').addEventListener('click', async () => {
  await send('unpair');
  await boot();
});

void boot();
