/**
 * Service worker: the only thing that talks to the platform API.
 *
 * The content script never holds the device credential and never makes a
 * network request — it receives a fill plan and reports what happened. So a
 * compromised page cannot reach the API even if it manages to talk to the
 * content script, because the content script has nothing to reach it with.
 */

const DEFAULT_API = 'http://localhost:4000/api/v1';
const AGENT_VERSION = chrome.runtime.getManifest().version;

/* ------------------------------- storage -------------------------------- */

async function getSettings() {
  const { apiBase, device } = await chrome.storage.local.get(['apiBase', 'device']);
  return { apiBase: apiBase || DEFAULT_API, device: device || null };
}

async function setDevice(device) {
  await chrome.storage.local.set({ device });
}

async function clearDevice() {
  await chrome.storage.local.remove('device');
}

/* -------------------------------- fetch --------------------------------- */

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const { apiBase, device } = await getSettings();

  if (auth && !device) {
    const err = new Error('This browser is not paired yet');
    err.code = 'NOT_PAIRED';
    throw err;
  }

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = `Device ${device.deviceId}.${device.deviceSecret}`;

  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = new Error(data?.title || `Request failed (${res.status})`);
    err.status = res.status;
    err.detail = data?.detail;
    // A revoked or expired pairing should present as "pair again", not as a
    // mysterious failure the CA has to interpret.
    if (res.status === 401) err.code = 'NOT_PAIRED';
    throw err;
  }

  return data;
}

/* -------------------------------- pairing ------------------------------- */

async function pair({ code, label, apiBase }) {
  if (apiBase) await chrome.storage.local.set({ apiBase });
  const { apiBase: base } = await getSettings();

  const res = await fetch(`${base}/extension/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code, label, agentVersion: AGENT_VERSION }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.title || 'Pairing failed');

  await setDevice({
    deviceId: data.deviceId,
    deviceSecret: data.deviceSecret,
    expiresAt: data.expiresAt,
  });

  return { expiresAt: data.expiresAt };
}

/* ------------------------------ host policy ----------------------------- */

/**
 * The extension acts on one host, and the host comes from the server.
 *
 * Belt and braces with the manifest's host_permissions: that already stops
 * injection anywhere else, and this stops us from even trying — so a misread
 * tab produces a clear refusal rather than a permissions error.
 */
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function assertAllowedTab(tab) {
  if (!tab?.id || !tab.url) throw new Error('No active tab');

  const me = await api('/extension/me');
  const host = hostOf(tab.url);

  if (!host || !me.hosts.map((h) => h.toLowerCase()).includes(host)) {
    const err = new Error(
      `This extension only works on ${me.hosts.join(', ')} — the current tab is ${host ?? 'not a page'}.`,
    );
    err.code = 'WRONG_HOST';
    throw err;
  }

  return { me, host };
}

/** Injects the content script on an explicit user action, never on page load. */
async function runInTab(tabId, func, args = []) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func,
    args,
  });
  return result?.result;
}

/* ------------------------------- capture -------------------------------- */

async function capturePage({ tab, formCode, label, note }) {
  const { host } = await assertAllowedTab(tab);

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['src/content.js'],
  });
  const fields = await runInTab(tab.id, () => window.__ifpAssistant.capture());

  if (!fields?.length) throw new Error('No form controls were found on this page');

  const created = await api('/extension/captures', {
    method: 'POST',
    body: {
      formCode,
      host,
      pathHint: new URL(tab.url).pathname.slice(0, 250),
      label,
      note: note || undefined,
      fields,
    },
  });

  return created;
}

/* --------------------------------- fill --------------------------------- */

/**
 * Builds the fill plan and hands it to the page.
 *
 * The plan is a list of {selector, value, controlType}. That is all the
 * content script ever receives: no case, no client, no credential, and
 * nothing that would let it ask for more.
 */
async function fillCase({ tab, caseId, formCode, dryRun }) {
  await assertAllowedTab(tab);

  const mapping = await api(`/extension/forms/${encodeURIComponent(formCode)}/mapping`);
  if (!mapping.version) {
    const err = new Error('No field map has been captured for this form yet');
    err.code = 'NO_MAPPING';
    throw err;
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['src/content.js'],
  });

  const pageFingerprint = await runInTab(tab.id, () => window.__ifpAssistant.fingerprint());

  const session = await api('/extension/sessions', {
    method: 'POST',
    body: { caseId, formVersionId: mapping.version.id, pageFingerprint },
  });

  const payload = await api(`/extension/cases/${caseId}/payload`);

  const plan = [];
  const outcomes = [];

  for (const m of mapping.mappings) {
    const raw = payload.values[m.sourcePath];
    if (raw === undefined || raw === '') {
      outcomes.push({ sourcePath: m.sourcePath, selector: m.selector, outcome: 'NO_VALUE' });
      continue;
    }
    plan.push({
      sourcePath: m.sourcePath,
      selector: m.selector,
      controlType: m.controlType,
      inputType: m.inputType,
      value: applyTransform(raw, m.transform),
      optionMap: m.optionMap || null,
      label: m.labelText || m.sourcePath,
    });
  }

  let applied = [];
  if (!dryRun && plan.length > 0) {
    applied = await runInTab(tab.id, (p) => window.__ifpAssistant.fill(p), [plan]);
  } else {
    applied = plan.map((p) => ({
      sourcePath: p.sourcePath,
      selector: p.selector,
      outcome: 'SKIPPED',
      detail: 'Preview only',
    }));
  }

  outcomes.push(...applied);

  await api(`/extension/sessions/${session.id}/finish`, {
    method: 'POST',
    body: { status: dryRun ? 'ABANDONED' : 'COMPLETED', outcomes },
  });

  return {
    sessionId: session.id,
    driftDetected: session.driftDetected,
    caseNumber: session.caseNumber,
    planned: plan.length,
    outcomes,
    refusedOnPage: mapping.refused ?? [],
    dryRun: Boolean(dryRun),
  };
}

/**
 * The same closed set of transforms the server knows about.
 *
 * Duplicated rather than fetched as code: the extension must never execute
 * anything it received over the network, and MV3's CSP would refuse to anyway.
 */
function applyTransform(value, transform) {
  switch (transform) {
    case 'upper':
      return value.toUpperCase();
    case 'lower':
      return value.toLowerCase();
    case 'trim':
      return value.trim();
    case 'digitsOnly':
      return value.replace(/\D/g, '');
    case 'dateDDMMYYYY': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
    }
    case 'dateDDMMYYYYDash': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : value;
    }
    case 'amountWhole':
      return value.split('.')[0] ?? value;
    case 'amountPlain':
      return value.replace(/,/g, '');
    default:
      return value;
  }
}

/* ------------------------------- messaging ------------------------------ */

const handlers = {
  async status() {
    const { apiBase, device } = await getSettings();
    if (!device) return { paired: false, apiBase };
    try {
      const me = await api('/extension/me');
      return { paired: true, apiBase, me, expiresAt: device.expiresAt };
    } catch (err) {
      if (err.code === 'NOT_PAIRED') {
        await clearDevice();
        return { paired: false, apiBase, error: err.message };
      }
      return { paired: true, apiBase, error: err.message };
    }
  },

  pair: (msg) => pair(msg),

  async unpair() {
    await clearDevice();
    return { ok: true };
  },

  cases: () => api('/extension/cases'),

  mapping: (msg) => api(`/extension/forms/${encodeURIComponent(msg.formCode)}/mapping`),

  capture: (msg) => capturePage(msg),

  fill: (msg) => fillCase(msg),

  async clearMarks(msg) {
    await chrome.scripting.executeScript({
      target: { tabId: msg.tab.id },
      files: ['src/content.js'],
    });
    return runInTab(msg.tab.id, () => window.__ifpAssistant.clearMarks());
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) {
    sendResponse({ ok: false, error: `Unknown request: ${msg?.type}` });
    return false;
  }

  handler(msg)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err.message, code: err.code }));

  // Keeps the message channel open for the async response.
  return true;
});
