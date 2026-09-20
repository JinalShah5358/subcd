/**
 * End-to-end: capture -> map -> activate -> fill, against the running API and
 * a real DOM, exercising the actual content script.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const BASE = 'http://localhost:4000/api/v1';
const P = (s) => console.log(' ', s);
let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const CONTENT = readFileSync('apps/extension/src/content.js', 'utf8');

/** A stand-in for the portal form. Nobody has seen the real one. */
const PAGE = `<!doctype html><html><body><form id="app">
<table>
<tr><td>Name of Applicant</td><td><input id="txtApplicant" name="txtApplicant" /></td></tr>
<tr><td>PAN of the Unit</td><td><input id="txtPan" name="txtPan" maxlength="10" /></td></tr>
<tr><td>Date of Commercial Production</td><td><input id="txtDocp" name="txtDocp" /></td></tr>
<tr><td>District</td><td><select id="ddlDistrict" name="ddlDistrict">
  <option value="">--Select--</option><option value="24">Ahmedabad</option></select></td></tr>
<tr><td>Portal password</td><td><input type="password" id="txtPwd" name="txtPwd" /></td></tr>
<tr><td>Enter code</td><td><input id="txtCaptchaCode" name="txtCaptchaCode" /></td></tr>
<tr><td></td><td><input type="submit" id="btnSubmit" value="Submit" /></td></tr>
</table></form></body></html>`;

function makePage() {
  // runScripts is required or window.eval runs in Node's context, where
  // there is no window and the content script bails on its first line.
  const dom = new JSDOM(PAGE, { url: 'https://ifp.gujarat.gov.in/apply', runScripts: 'dangerously' });
  const { window } = dom;
  // jsdom ships no SubtleCrypto; the real portal is HTTPS and has it, so
  // lend jsdom Node's so the genuine fingerprint path is exercised here.
  if (!window.crypto.subtle) {
    Object.defineProperty(window.crypto, 'subtle', { value: globalThis.crypto.subtle });
  }
  if (!window.TextEncoder) window.TextEncoder = TextEncoder;
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return this.ownerDocument.body; },
  });
  window.eval(CONTENT);
  return window;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Login is capped at 5/min per IP — correct behaviour, so wait it out. */
async function login(email, password = 'ChangeMe!Dev2026') {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await fetch(`${BASE}/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }) });
    const body = await r.json().catch(() => ({}));
    if (body.accessToken) return body.accessToken;

    // 429 is the limiter working. Anything else without a token this early is
    // almost always the same thing wearing a different status, and waiting
    // costs a minute where failing costs a re-run of the whole suite.
    P(`   (login returned ${r.status} — waiting 62s and retrying)`);
    await sleep(62_000);
  }
  throw new Error(`login kept being rate limited for ${email}`);
}

async function call(auth, path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: {
    Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(auth ? { Authorization: auth } : {}) } });
  const t = await res.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  return { status: res.status, data: d };
}

const token = await login('ca@demo.local');
const bearer = `Bearer ${token}`;

// --- pair -------------------------------------------------------------
let r = await call(bearer, '/extension/pairing-codes', { method: 'POST' });
const { code } = r.data;
r = await call(null, '/extension/pair', { method: 'POST',
  body: JSON.stringify({ code, label: 'E2E browser', agentVersion: '0.1.0' }) });
ok('browser pairs', r.status === 201, `got ${r.status}`);
const device = `Device ${r.data.deviceId}.${r.data.deviceSecret}`;

// --- capture the page -------------------------------------------------
const win = makePage();
const captured = win.__ifpAssistant.capture();
ok('content script found the controls', captured.length >= 7, `got ${captured.length}`);
ok('password / captcha / submit were refused at capture',
  captured.filter((f) => f.refusedReason).length >= 3,
  `refused ${captured.filter((f) => f.refusedReason).length}`);

r = await call(device, '/extension/captures', { method: 'POST', body: JSON.stringify({
  formCode: 'IFP_CAPITAL_SUBSIDY',
  host: 'ifp.gujarat.gov.in',
  label: `E2E capture ${Date.now()}`,
  fields: captured,
}) });
ok('capture is accepted', r.status === 201, `got ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
const versionId = r.data?.id;
P(`   captured ${r.data?.fieldCount} control(s), ${r.data?.refusedCount} refused`);

// A capture from the wrong host must be refused.
r = await call(device, '/extension/captures', { method: 'POST', body: JSON.stringify({
  formCode: 'IFP_CAPITAL_SUBSIDY', host: 'evil.example.com', label: 'x', fields: captured }) });
ok('a capture from another host is refused', r.status === 403, `got ${r.status}`);

// --- review and map ---------------------------------------------------
r = await call(bearer, `/extension/form-versions/${versionId}`);
ok('the capture can be reviewed', r.status === 200, `got ${r.status}`);
const fields = r.data?.fields ?? [];
const byId = (idAttr) => fields.find((f) => f.idAttr === idAttr);

const MAP = [
  ['txtApplicant', 'client.legalName', null],
  ['txtPan', 'client.pan', 'upper'],
  ['txtDocp', 'project.commercialProductionDate', 'dateDDMMYYYY'],
];
let mapped = 0;
for (const [idAttr, sourcePath, transform] of MAP) {
  const field = byId(idAttr);
  if (!field) continue;
  const res = await call(bearer, `/extension/form-versions/${versionId}/mappings`, {
    method: 'PUT',
    body: JSON.stringify({ formFieldId: field.id, sourcePath, transform, confirmed: true }),
  });
  if (res.status === 200) mapped++;
}
ok('fields can be mapped to data paths', mapped === MAP.length, `${mapped}/${MAP.length}`);

// Mapping a refused control must be impossible.
const refusedField = fields.find((f) => f.refusedReason);
r = await call(bearer, `/extension/form-versions/${versionId}/mappings`, { method: 'PUT',
  body: JSON.stringify({ formFieldId: refusedField.id, sourcePath: 'client.pan', confirmed: true }) });
ok('a refused control cannot be mapped', r.status === 403, `got ${r.status}`);

// Unknown paths and transforms are refused.
r = await call(bearer, `/extension/form-versions/${versionId}/mappings`, { method: 'PUT',
  body: JSON.stringify({ formFieldId: byId('txtApplicant').id, sourcePath: 'client.secretSauce', confirmed: true }) });
ok('an unknown data path is refused', r.status === 400, `got ${r.status}`);

// --- activate ---------------------------------------------------------
r = await call(bearer, `/extension/form-versions/${versionId}/status`, {
  method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) });
ok('a reviewed capture can be activated', r.status === 200, `got ${r.status}`);

// --- fill -------------------------------------------------------------
r = await call(device, '/extension/forms/IFP_CAPITAL_SUBSIDY/mapping');
ok('the extension now gets a mapping', r.status === 200 && r.data?.version !== null, `got ${r.status}`);
const mapping = r.data;
ok('no refused control appears in the mapping',
  !JSON.stringify(mapping.mappings).includes('txtPwd') &&
  !JSON.stringify(mapping.mappings).includes('txtCaptchaCode'));

r = await call(device, '/extension/cases');
const caseId = r.data?.[0]?.id;

r = await call(device, `/extension/cases/${caseId}/payload`);
const payload = r.data;
ok('the payload carries real values', Object.keys(payload.values).length > 0);

const plan = [];
for (const m of mapping.mappings) {
  const raw = payload.values[m.sourcePath];
  if (raw === undefined) continue;
  let value = raw;
  if (m.transform === 'upper') value = value.toUpperCase();
  if (m.transform === 'dateDDMMYYYY') {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dm) value = `${dm[3]}/${dm[2]}/${dm[1]}`;
  }
  plan.push({ sourcePath: m.sourcePath, selector: m.selector, controlType: m.controlType, value });
}
ok('a fill plan is produced', plan.length > 0, `${plan.length} field(s)`);

const results = win.__ifpAssistant.fill(plan);
const filled = results.filter((x) => x.outcome === 'FILLED').length;
ok('the page is actually filled', filled > 0, `${filled} filled`);
P(`   txtApplicant = "${win.document.querySelector('#txtApplicant').value}"`);
P(`   txtPan       = "${win.document.querySelector('#txtPan').value}"`);

ok('the password box is still empty', win.document.querySelector('#txtPwd').value === '');
ok('the captcha box is still empty', win.document.querySelector('#txtCaptchaCode').value === '');

// --- report -----------------------------------------------------------
r = await call(device, '/extension/sessions', { method: 'POST',
  body: JSON.stringify({ caseId, formVersionId: mapping.version.id,
    pageFingerprint: await win.__ifpAssistant.fingerprint() }) });
ok('a session starts', r.status === 201, `got ${r.status}`);
ok('no drift against the version just captured', r.data?.driftDetected === false);
const sessionId = r.data?.id;

r = await call(device, `/extension/sessions/${sessionId}/finish`, { method: 'POST',
  body: JSON.stringify({ status: 'COMPLETED', outcomes: results }) });
ok('outcomes are recorded', r.status === 200 && r.data?.filled === filled, `got ${r.status}`);

// --- drift ------------------------------------------------------------
r = await call(device, '/extension/sessions', { method: 'POST',
  body: JSON.stringify({ caseId, formVersionId: mapping.version.id, pageFingerprint: 'a'.repeat(64) }) });
ok('a changed page is flagged as drift', r.data?.driftDetected === true);

// --- the audit trail must name fields, never values --------------------
const adminToken = await login('admin@demo.local');
r = await call(`Bearer ${adminToken}`, '/audit?pageSize=100');
const rows = r.data?.items ?? [];

// Without this, an empty audit page makes every canary below pass on nothing —
// which is exactly how a leak test ends up proving it.
ok('the audit log was actually read', r.status === 200 && rows.length > 0,
  `status ${r.status}, ${rows.length} rows`);
const text = JSON.stringify(rows).replace(
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>');
const actions = new Set(rows.map((x) => x.action));

ok('pairing is audited', actions.has('EXTENSION_DEVICE_PAIRED'));
ok('capture is audited', actions.has('FORM_CAPTURED'));
ok('mapping is audited', actions.has('FIELD_MAPPED'));
ok('the autofill run is audited', actions.has('AUTOFILL_COMPLETED'));

const pan = payload.values['client.pan'];
ok('no PAN in the audit trail', !pan || !text.includes(pan), 'a PAN reached the audit log');
const name = payload.values['client.legalName'];
ok('no filled value in the audit trail', !text.includes(name), 'a filled value reached the audit log');

const autofillRow = rows.find((x) => x.action === 'AUTOFILL_COMPLETED');
ok('the autofill row records submitted:false', autofillRow?.metadata?.submitted === false,
  JSON.stringify(autofillRow?.metadata));
ok('the autofill row lists field names only',
  Array.isArray(autofillRow?.changedFields) && autofillRow.changedFields.every((f) => f.includes('.')));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
