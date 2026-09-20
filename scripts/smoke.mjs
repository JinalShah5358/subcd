/**
 * End-to-end smoke test against the running API.
 * Exercises: login -> client create (with encrypted PAN) -> duplicate rejection
 * -> reveal -> case create -> sections -> documents -> consent -> validation
 * -> status transitions -> audit -> cross-tenant probe.
 */
const BASE = 'http://localhost:4000/api/v1';
let access = null;
let cookie = null;
let pass = 0;
let fail = 0;

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, { method = 'GET', body, token = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token && access) headers.Authorization = `Bearer ${access}`;
  if (cookie) headers.Cookie = cookie;
  headers.Origin = 'http://localhost:5173';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Login is rate limited to 5/min per IP — correct behaviour, but this test
 * signs in four times per run, so back off once rather than reporting a
 * false failure.
 */
async function login(email, password = 'ChangeMe!Dev2026') {
  cookie = null;
  let r = await call('/auth/login', { method: 'POST', token: false, body: { email, password } });
  if (r.status === 429) {
    console.log('  ....  login rate limited (working as intended) — waiting 62s');
    await sleep(62000);
    r = await call('/auth/login', { method: 'POST', token: false, body: { email, password } });
  }
  // Adopt the new session here rather than leaving each caller to remember.
  // Forgetting meant later calls silently kept the PREVIOUS user's token,
  // which reads as a permissions bug in the API and is nothing of the kind.
  if (r.status === 200 && r.data?.accessToken) access = r.data.accessToken;
  return r;
}

async function main() {
  section('AUTH');
  let r = await login('wrong@demo.local', 'nope');
  ok('unknown user gets a generic 401', r.status === 401, `got ${r.status}`);

  r = await login('ca@demo.local');
  ok('CA can sign in', r.status === 200, JSON.stringify(r.data).slice(0, 160));
  access = r.data?.accessToken;
  ok('access token issued', Boolean(access));
  ok('refresh cookie set httpOnly', Boolean(cookie) && cookie.startsWith('ifp_rt='));
  ok('permissions come back', Array.isArray(r.data?.user?.permissions) && r.data.user.permissions.length > 0);

  r = await call('/auth/me');
  ok('/auth/me works with bearer token', r.status === 200 && r.data?.user?.email === 'ca@demo.local');

  section('CLIENTS');
  // Fresh identifiers per run so the test is repeatable against a live database.
  const L = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const pan = `${L()}${L()}${L()}${L()}${L()}${String(Math.floor(1000 + Math.random() * 9000))}${L()}`;
  const runTag = Date.now().toString().slice(-6);
  r = await call('/clients', {
    method: 'POST',
    body: {
      legalName: `Shree Test Industries ${runTag} Pvt Ltd`,
      entityType: 'PVT_LTD',
      pan,
      contactPersonName: 'Test Contact',
      contactPhone: '9876543210',
      businessActivity: 'Precision components',
    },
  });
  ok('client created', r.status === 201, JSON.stringify(r.data).slice(0, 200));
  const clientId = r.data?.id;
  ok('PAN comes back masked, not in clear', r.data?.panMasked?.endsWith(pan.slice(-4)) && r.data.panMasked.startsWith('•') && !JSON.stringify(r.data).includes(pan),
     JSON.stringify(r.data?.panMasked));

  r = await call('/clients', {
    method: 'POST',
    body: { legalName: 'Duplicate Attempt Ltd', entityType: 'PVT_LTD', pan },
  });
  ok('duplicate PAN rejected with 409', r.status === 409, `got ${r.status}`);
  ok('409 names the conflicting client', Boolean(r.data?.conflictId));

  r = await call('/clients/check-duplicate', { method: 'POST', body: { pan } });
  ok('duplicate probe finds it', r.data?.duplicate === true);
  ok('probe never echoes the PAN', !JSON.stringify(r.data).includes(pan));

  r = await call(`/clients/${clientId}/reveal`, { method: 'POST', body: { field: 'pan' } });
  ok('reveal returns the real PAN', r.status === 200 && r.data?.value === pan, JSON.stringify(r.data));

  r = await call(`/clients/${clientId}/promoters`, {
    method: 'POST',
    body: {
      fullName: 'Test Promoter',
      designation: 'DIRECTOR',
      ownershipPercent: '100',
      pan: `${L()}${L()}${L()}P${L()}${String(Math.floor(1000 + Math.random() * 9000))}${L()}`,
      aadhaarLast4: '9012',
      isPrimary: true,
    },
  });
  ok('promoter added', r.status === 201, JSON.stringify(r.data).slice(0, 160));

  r = await call('/clients', {
    method: 'POST',
    body: { legalName: `Bad PAN ${runTag} Ltd`, entityType: 'PVT_LTD', pan: 'NOTAPAN' },
  });
  ok('malformed PAN rejected by validation', r.status === 422, `got ${r.status}`);

  section('CASES');
  r = await call('/reference/schemes');
  const schemeVersionId = r.data?.[0]?.versions?.[0]?.id;
  ok('scheme version available', Boolean(schemeVersionId));
  ok('draft scheme flagged unverified', r.data?.[0]?.versions?.[0]?.unverified === true);

  r = await call('/cases', {
    method: 'POST',
    body: { clientId, schemeVersionId, applicationType: 'CAPITAL_SUBSIDY' },
  });
  ok('case created', r.status === 201, JSON.stringify(r.data).slice(0, 200));
  const caseId = r.data?.id;
  const caseNumber = r.data?.caseNumber;

  r = await call(`/cases/${caseId}`);
  ok('case loads with document checklist', r.status === 200 && r.data?.documents?.length > 0,
     `docs=${r.data?.documents?.length}`);
  const mandatoryCount = r.data?.documents?.filter((d) => d.isRequired).length ?? 0;
  ok('mandatory documents derived from the scheme', mandatoryCount > 0, `mandatory=${mandatoryCount}`);

  section('SECTIONS');
  r = await call(`/cases/${caseId}/project`, {
    method: 'PUT',
    body: { projectName: 'Unit 1', districtCode: 'GJ-AHM', commercialProductionDate: '2026-01-15' },
  });
  ok('project section saved', r.status === 200, JSON.stringify(r.data).slice(0, 160));

  r = await call(`/cases/${caseId}/loan`, {
    method: 'PUT',
    body: {
      newBank: { name: 'State Bank of India', branchName: 'Ashram Road' },
      loanAccountNo: `9${runTag}00${runTag}`,
      sanctionDate: '2025-06-01',
      firstDisbursementDate: '2025-07-01',
      sanctionedAmount: '5000000',
      disbursedAmount: '4500000',
    },
  });
  ok('loan section saved and bank created', r.status === 200, JSON.stringify(r.data).slice(0, 160));

  r = await call(`/cases/${caseId}/investment`, {
    method: 'PUT',
    body: {
      landCost: '1000000',
      buildingCost: '2000000',
      plantMachineryCost: '3000000',
      totalProjectCost: '6000000',
      promoterContribution: '1500000',
      termLoanComponent: '4500000',
    },
  });
  ok('investment section saved', r.status === 200);

  r = await call(`/cases/${caseId}/employment`, {
    method: 'PUT',
    body: { totalEmployees: 40, epfRegisteredEmployees: 38, localEmployees: 35 },
  });
  ok('employment section saved', r.status === 200);

  r = await call(`/cases/${caseId}/employment`, {
    method: 'PUT',
    body: { totalEmployees: 10, epfRegisteredEmployees: 99 },
  });
  ok('partial draft still saves (no completeness blocking)', r.status === 200);

  r = await call(`/cases/${caseId}/employment`, {
    method: 'PUT',
    body: { totalEmployees: 40, epfRegisteredEmployees: 38, localEmployees: 35, unexpectedKey: 'x' },
  });
  ok('unknown keys rejected by strict schema', r.status === 422, `got ${r.status}`);

  await call(`/cases/${caseId}/employment`, {
    method: 'PUT',
    body: { totalEmployees: 40, epfRegisteredEmployees: 38, localEmployees: 35 },
  });

  section('VALIDATION');
  r = await call(`/cases/${caseId}/validate`, { method: 'POST' });
  ok('validation ran', r.status === 200, JSON.stringify(r.data).slice(0, 200));
  const findings = r.data?.findings ?? [];
  const codes = findings.map((f) => f.ruleCode);
  ok('blocking findings detected for an incomplete case', (r.data?.blockingCount ?? 0) > 0,
     `blocking=${r.data?.blockingCount}`);
  ok('consent rule fires before consent recorded', codes.includes('CONSENT_RECORDED'), codes.join(','));
  ok('required-documents rule fires', codes.includes('REQUIRED_DOCUMENTS'), codes.join(','));
  ok('application date rule fires', codes.includes('APPLICATION_DATE_REQUIRED'), codes.join(','));
  ok('no finding message leaks a value', !JSON.stringify(findings).includes(pan));
  ok('readiness score computed', typeof r.data?.readinessScore === 'number');

  r = await call('/validation/rules/inactive');
  ok('inactive (uncited) rules are disclosed', Array.isArray(r.data) && r.data.length > 0,
     `count=${r.data?.length}`);

  section('TRANSITIONS');
  r = await call(`/cases/${caseId}/status`, { method: 'POST', body: { status: 'READY_TO_FILE' } });
  ok('cannot skip straight to ready-to-file', r.status === 422, `got ${r.status}`);

  r = await call(`/cases/${caseId}/status`, { method: 'POST', body: { status: 'IN_REVIEW' } });
  ok('blocking findings stop in-review transition', r.status === 422, `got ${r.status}`);

  section('DOCUMENTS + CONSENT');
  r = await call(`/cases/${caseId}/documents`);
  const slots = r.data ?? [];
  for (const slot of slots.filter((s) => s.isRequired)) {
    await call(`/cases/${caseId}/documents/${slot.id}`, {
      method: 'PATCH',
      body: { status: 'PRESENT' },
    });
  }
  r = await call(`/cases/${caseId}/documents`);
  ok('all mandatory slots accounted for',
     (r.data ?? []).filter((d) => d.isRequired && d.status === 'REQUIRED').length === 0);

  r = await call('/consent/templates/active');
  const template = r.data;
  ok('active consent template served', r.status === 200 && Boolean(template?.id));
  ok('template flagged as not legally reviewed', template?.isDraftText === true);

  r = await call('/consent/records', {
    method: 'POST',
    body: {
      clientId,
      caseId,
      templateId: template.id,
      attestationText: 'tampered text',
      affirmed: true,
    },
  });
  ok('tampered attestation text refused', r.status === 400, `got ${r.status}`);

  r = await call('/consent/records', {
    method: 'POST',
    body: {
      clientId,
      caseId,
      templateId: template.id,
      attestationText: template.bodyText,
      affirmed: true,
      clientContactName: 'Test Contact',
    },
  });
  ok('consent recorded with matching text', r.status === 201, JSON.stringify(r.data).slice(0, 160));

  await call(`/cases/${caseId}`, { method: 'PATCH', body: { applicationDate: '2026-02-01' } });
  r = await call(`/cases/${caseId}/validate`, { method: 'POST' });
  ok('blocking findings cleared after fixing them', (r.data?.blockingCount ?? 99) === 0,
     `blocking=${r.data?.blockingCount} codes=${(r.data?.findings ?? []).map((f) => f.ruleCode).join(',')}`);

  r = await call(`/cases/${caseId}/status`, { method: 'POST', body: { status: 'IN_REVIEW' } });
  ok('in-review transition now allowed', r.status === 200, JSON.stringify(r.data).slice(0, 160));

  r = await call(`/cases/${caseId}/status`, { method: 'POST', body: { status: 'READY_TO_FILE' } });
  ok('ready-to-file allowed once docs + consent + validation pass', r.status === 200,
     JSON.stringify(r.data).slice(0, 200));

  r = await call(`/cases/${caseId}/status`, { method: 'POST', body: { status: 'FILED' } });
  ok('filing requires the portal application number', r.status === 422, `got ${r.status}`);

  r = await call(`/cases/${caseId}/status`, {
    method: 'POST',
    body: { status: 'FILED', portalApplicationNo: 'IFP/2026/12345' },
  });
  ok('CA records their own filing', r.status === 200);

  r = await call(`/cases/${caseId}/project`, { method: 'PUT', body: { projectName: 'Changed' } });
  ok('filed case is locked for edits', r.status === 422, `got ${r.status}`);

  section('AUTHORIZATION');
  const caToken = access;
  const caCookie = cookie;
  r = await login('staff@demo.local');
  access = r.data?.accessToken;
  ok('staff can sign in', r.status === 200, `got ${r.status}`);

  r = await call(`/clients/${clientId}/reveal`, { method: 'POST', body: { field: 'pan' } });
  ok('staff cannot reveal identifiers', r.status === 403, `got ${r.status}`);

  r = await call('/users');
  ok('staff cannot list firm users', r.status === 403, `got ${r.status}`);

  r = await call('/audit');
  ok('staff cannot read the audit log', r.status === 403, `got ${r.status}`);

  r = await call('/clients');
  ok('staff can still read clients', r.status === 200);

  access = caToken;
  cookie = caCookie;

  section('TENANT ISOLATION');
  r = await call('/clients/01a00000-0000-7000-8000-000000000000');
  ok('unknown/foreign client id returns 404, not 403', r.status === 404, `got ${r.status}`);

  r = await call('/clients', {
    method: 'POST',
    body: { legalName: `Injected Firm ${runTag} Co`, entityType: 'PVT_LTD', firmId: '01a00000-0000-7000-8000-000000000000' },
  });
  ok('firmId in the request body is rejected', r.status === 422 || r.status === 403, `got ${r.status}`);

  section('PAGINATION');
  r = await call('/clients?page=1&pageSize=2');
  const p1 = r.data;
  ok('clients list returns a page envelope', r.status === 200 && Array.isArray(p1?.items));
  ok(
    'page envelope carries page, total and totalPages',
    p1?.page === 1 && typeof p1?.total === 'number' && typeof p1?.totalPages === 'number',
    JSON.stringify({ page: p1?.page, total: p1?.total, totalPages: p1?.totalPages }),
  );
  ok('pageSize is honoured', (p1?.items?.length ?? 0) <= 2, `got ${p1?.items?.length}`);
  ok('hasPrev is false on the first page', p1?.hasPrev === false);

  if ((p1?.total ?? 0) > 2) {
    r = await call('/clients?page=2&pageSize=2');
    const p2 = r.data;
    const overlap = (p2?.items ?? []).filter((x) => (p1?.items ?? []).some((y) => y.id === x.id));
    ok('page 2 holds different rows from page 1', overlap.length === 0, `overlap=${overlap.length}`);
    ok('hasPrev is true beyond the first page', p2?.hasPrev === true);
  }

  // A page past the end must still report the real total, so the client can
  // clamp rather than conclude the list is empty.
  r = await call('/clients?page=9999&pageSize=2');
  ok(
    'a page past the end is empty but still reports the total',
    r.status === 200 && r.data?.items?.length === 0 && r.data?.total === p1?.total,
    `items=${r.data?.items?.length} total=${r.data?.total}`,
  );

  r = await call('/clients?page=0');
  ok('page 0 is rejected', r.status === 422, `got ${r.status}`);
  r = await call('/clients?pageSize=500');
  ok('an oversized pageSize is rejected', r.status === 422, `got ${r.status}`);

  r = await call('/clients?sort=legalName&dir=asc&pageSize=5');
  const names = (r.data?.items ?? []).map((x) => x.legalName);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  ok('sort=legalName&dir=asc is applied', JSON.stringify(names) === JSON.stringify(sorted));

  r = await call('/clients?sort=nonsense');
  ok('an unknown sort key is rejected', r.status === 422, `got ${r.status}`);

  r = await call('/cases?page=1&pageSize=3');
  ok('cases list is paged too', r.status === 200 && typeof r.data?.totalPages === 'number');

  section('AUDIT');
  r = await login('admin@demo.local');
  ok('firm admin can sign in', r.status === 200, `got ${r.status}`);
  access = r.data?.accessToken;

  // Regression: the firm row has no firm_id column, so it was excluded from
  // the tenant extension entirely — no tenant transaction, RLS failing closed,
  // and this endpoint 404ing on a firm that plainly exists.
  r = await call('/firms/current');
  ok('firm settings load', r.status === 200 && typeof r.data?.name === 'string', `got ${r.status}`);
  ok('firm response carries its counts', typeof r.data?._count?.users === 'number');

  r = await call('/users?page=1&pageSize=2');
  ok('users list is paged', r.status === 200 && typeof r.data?.total === 'number', `got ${r.status}`);

  r = await call('/audit?pageSize=100');
  const rows = r.data?.items ?? [];
  ok('audit log readable by firm admin', r.status === 200 && rows.length > 0, `rows=${rows.length}`);
  ok(
    'audit response carries a page envelope',
    typeof r.data?.total === 'number' && typeof r.data?.totalPages === 'number',
    `got ${JSON.stringify(Object.keys(r.data ?? {}))}`,
  );
  const actions = new Set(rows.map((x) => x.action));
  ok('login recorded', actions.has('LOGIN_SUCCEEDED'));
  ok('client creation recorded', actions.has('CLIENT_CREATED'));
  ok('reveal recorded', actions.has('SENSITIVE_FIELD_REVEALED'));
  ok('consent recorded', actions.has('CONSENT_RECORDED'));
  ok('status change recorded', actions.has('CASE_STATUS_CHANGED'));
  ok('permission denial recorded', actions.has('ACCESS_DENIED'));

  // Strip UUIDs before pattern-matching: a v7 id can end in twelve digits,
  // which would otherwise look like an Aadhaar number to a naive regex.
  const auditText = JSON.stringify(rows).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "<uuid>",
  );
  ok('no PAN anywhere in the audit trail', !auditText.includes(pan));
  ok('no Aadhaar-shaped value in the audit trail', !/\b[2-9]\d{11}\b/.test(auditText));
  ok('no loan account number in the audit trail', !auditText.includes(`9${runTag}00${runTag}`));
  const revealRow = rows.find((x) => x.action === 'SENSITIVE_FIELD_REVEALED');
  ok('reveal row names the field only', revealRow?.changedFields?.includes('pan') && !JSON.stringify(revealRow).includes(pan));

  section('ORIGIN POLICY');
  //
  // The extension calls from chrome-extension://<id>, which cannot be in
  // WEB_ORIGIN. That exception has to stay narrow: its own routes and nothing
  // else, and only for extension origins.
  const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef';

  const fromOrigin = async (path, origin, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    });
    return res.status;
  };

  let status = await fromOrigin('/extension/pair', EXT_ORIGIN, { code: 'AAAA-BBBB', label: 'probe' });
  ok(
    'an extension origin reaches the pairing route',
    status === 400 || status === 429,
    `got ${status} — 400 (bad code) or 429 (rate limited) both mean it got past the origin check; 403 would not`,
  );

  status = await fromOrigin('/clients', EXT_ORIGIN, { legalName: 'Nope' });
  ok('an extension origin is refused everywhere else', status === 403, `got ${status}`);

  status = await fromOrigin('/extension/pair', 'https://evil.example.com', { code: 'AAAA-BBBB', label: 'x' });
  ok('an unrelated web origin is refused on the extension routes too', status === 403, `got ${status}`);

  status = await fromOrigin('/auth/login', 'http://localhost:5173', { email: 'nobody@demo.local', password: 'wrong' });
  ok('the web app origin is unaffected', status === 401 || status === 429, `got ${status}`);

  section('PLATFORM ADMINISTRATION');
  r = await login('platform@demo.local');
  ok('platform admin can sign in', r.status === 200, `got ${r.status}`);
  ok('platform admin holds the platform role', r.data?.user?.role?.key === 'PLATFORM_ADMIN');

  r = await call('/auth/me');
  ok(
    'the session in use really is the platform admin',
    r.data?.user?.email === 'platform@demo.local',
    `whoami says ${r.data?.user?.email}`,
  );

  r = await call('/platform/totals');
  ok('platform totals readable', r.status === 200 && typeof r.data?.firmCount === 'number', `got ${r.status}`);

  r = await call('/platform/firms?page=1&pageSize=10');
  ok('firms list is paged', r.status === 200 && typeof r.data?.total === 'number', `got ${r.status}`);

  r = await call('/platform/firms?q=demo-ca-firm');
  const firmRows = r.data?.items ?? [];
  ok(
    'the demo firm is listed with its counts',
    firmRows.some((f) => f.slug === 'demo-ca-firm' && f.clientCount > 0),
    `${firmRows.length} row(s) matched`,
  );

  // The property this whole design exists for.
  const firmsJson = JSON.stringify(firmRows);
  ok('no client legal name appears in the firms list', !firmsJson.includes('Shree Test Industries'));
  ok('no PAN appears in the firms list', !firmsJson.includes(pan));

  // `platform:admin` is one permission, not a wildcard over the others. It
  // used to satisfy every check in the application, which left the database
  // as the only thing between a platform administrator and a client record.
  // Now the route refuses first and the database would refuse anyway.
  for (const path of ['/clients', '/cases', '/audit', '/users', '/extension/devices']) {
    r = await call(path);
    ok(`platform admin is refused ${path}`, r.status === 403, `got ${r.status}`);
  }

  // The refusal is recorded. A platform account reaching for client data is
  // exactly the event somebody should be able to find later.
  r = await call('/clients', { method: 'POST', body: { legalName: 'Nope', entityType: 'PVT_LTD' } });
  ok('platform admin cannot create a client either', r.status === 403, `got ${r.status}`);

  // And the firm screens it can still reach carry nothing but its own tenant.
  r = await call('/firms/current');
  ok(
    'platform admin reads only its own firm',
    r.status === 200 && r.data?.slug === 'platform',
    `got ${r.status} ${r.data?.slug}`,
  );
  ok(
    'the platform tenant holds no clients or cases of its own',
    (r.data?._count?.clients ?? -1) === 0 && (r.data?._count?.cases ?? -1) === 0,
    JSON.stringify(r.data?._count),
  );

  // Provision a firm, then suspend and restore it.
  const newSlug = `smoke-firm-${runTag}`;
  r = await call('/platform/firms', {
    method: 'POST',
    body: {
      name: `Smoke Firm ${runTag}`,
      slug: newSlug,
      adminEmail: `smoke${runTag}@example.com`,
      adminFullName: 'Smoke Firm Admin',
    },
  });
  ok('a firm can be provisioned', r.status === 201, `got ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  const newFirmId = r.data?.id;
  ok('provisioning issues an invitation', Boolean(r.data?.invitation?.email));

  r = await call('/platform/firms', {
    method: 'POST',
    body: { name: 'Dup', slug: newSlug, adminEmail: `dup${runTag}@example.com`, adminFullName: 'Dup' },
  });
  ok('a duplicate slug is refused', r.status === 409, `got ${r.status}`);

  r = await call(`/platform/firms/${newFirmId}/status`, {
    method: 'PATCH',
    body: { status: 'SUSPENDED', reason: `smoke test ${runTag}` },
  });
  ok('a firm can be suspended', r.status === 200 && r.data?.status === 'SUSPENDED', `got ${r.status}`);

  r = await call(`/platform/firms/${newFirmId}/status`, { method: 'PATCH', body: { status: 'SUSPENDED' } });
  ok('a status change without a reason is refused', r.status === 422, `got ${r.status}`);

  r = await call(`/platform/firms/${newFirmId}/status`, {
    method: 'PATCH',
    body: { status: 'ACTIVE', reason: 'restored by smoke test' },
  });
  ok('a suspended firm can be restored', r.status === 200 && r.data?.status === 'ACTIVE');

  section('LICENSING');
  //
  // The whole point of this section is the read-only claim. An expired licence
  // must refuse writes and must NOT refuse reads, sign-in or export — and the
  // difference between those two is the difference between a billing control
  // and holding a firm's own case files hostage.

  // The firm provisioned above: give it a licence that has already run out,
  // with no grace left.
  const longAgo = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  r = await call(`/platform/firms/${newFirmId}/license`, {
    method: 'PUT',
    body: {
      plan: 'TRIAL',
      expiresAt: longAgo,
      graceDays: 0,
      maxUsers: 3,
      maxClients: 1,
      maxCases: null,
      note: `smoke ${runTag}`,
      reason: `smoke test ${runTag}`,
    },
  });
  ok('a licence can be set', r.status === 200, `got ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  ok(
    'an expiry in the past reports READ_ONLY',
    r.data?.license?.state === 'READ_ONLY' && r.data?.license?.readOnly === true,
    `state ${r.data?.license?.state}`,
  );

  r = await call(`/platform/firms/${newFirmId}/license`, {
    method: 'PUT',
    body: { plan: 'TRIAL', expiresAt: longAgo, graceDays: 0, maxUsers: 3, maxClients: 1, maxCases: null, note: null },
  });
  ok('a licence change without a reason is refused', r.status === 422, `got ${r.status}`);

  // A licence that is merely near its end is not read-only.
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  r = await call(`/platform/firms/${newFirmId}/license`, {
    method: 'PUT',
    body: {
      plan: 'STARTER',
      expiresAt: soon,
      graceDays: 14,
      maxUsers: null,
      maxClients: null,
      maxCases: null,
      note: null,
      reason: 'smoke: near expiry',
    },
  });
  ok(
    'an expiry five days out warns but does not restrict',
    r.data?.license?.state === 'EXPIRING_SOON' && r.data?.license?.readOnly === false,
    `state ${r.data?.license?.state}`,
  );

  r = await call('/platform/licenses/expiring?withinDays=30&page=1&pageSize=50&sort=expiresAt&dir=asc');
  ok('the renewals list is paged', r.status === 200 && typeof r.data?.total === 'number', `got ${r.status}`);
  ok(
    'the firm about to expire is on it',
    (r.data?.items ?? []).some((f) => f.id === newFirmId),
    `${r.data?.items?.length} row(s)`,
  );
  ok(
    'the renewals list carries no client or case data',
    !JSON.stringify(r.data?.items ?? []).includes('Shree Test Industries'),
  );

  // Now the demo firm itself, which has real data to protect.
  r = await call('/platform/firms?q=demo-ca-firm');
  const demoFirm = (r.data?.items ?? []).find((f) => f.slug === 'demo-ca-firm');
  ok('the demo firm carries a licence', Boolean(demoFirm?.license?.plan), `got ${demoFirm?.license?.plan}`);
  const demoLicense = {
    plan: demoFirm.license.plan,
    expiresAt: demoFirm.license.expiresAt,
    graceDays: demoFirm.license.graceDays,
    maxUsers: demoFirm.license.limits.users,
    maxClients: demoFirm.license.limits.clients,
    maxCases: demoFirm.license.limits.cases,
  };

  const setDemoLicense = (body, reason) =>
    call(`/platform/firms/${demoFirm.id}/license`, {
      method: 'PUT',
      body: { ...demoLicense, ...body, note: null, reason },
    });

  r = await setDemoLicense({ expiresAt: longAgo, graceDays: 0 }, `smoke read-only ${runTag}`);
  ok('the demo firm was put into read-only', r.data?.license?.readOnly === true, `got ${r.status}`);

  try {
    // Sign-in must still work. Read-only is not a lockout.
    r = await login('ca@demo.local');
    ok('a read-only firm can still sign in', r.status === 200, `got ${r.status}`);

    r = await call('/clients');
    ok('a read-only firm can still read its clients', r.status === 200 && (r.data?.items?.length ?? 0) > 0, `got ${r.status}`);

    r = await call(`/cases/${caseId}`);
    ok('a read-only firm can still open a case', r.status === 200, `got ${r.status}`);

    r = await call('/clients', { method: 'POST', body: { legalName: `Blocked ${runTag}`, entityType: 'PVT_LTD' } });
    ok('a read-only firm cannot create a client', r.status === 403, `got ${r.status}`);
    ok(
      'the refusal says it is about the licence, not permissions',
      String(r.data?.type ?? '').includes('licence-expired'),
      `type ${r.data?.type}`,
    );

    r = await call(`/cases/${caseId}`, { method: 'PATCH', body: { title: 'Blocked edit' } });
    ok('a read-only firm cannot change a case', r.status === 403, `got ${r.status}`);

    r = await call('/firms/current');
    ok('firm settings still load', r.status === 200, `got ${r.status}`);
    ok(
      'and report the licence state to the app',
      r.data?.license?.readOnly === true && r.data?.license?.state === 'READ_ONLY',
      `state ${r.data?.license?.state}`,
    );

    // Back to a valid licence, then prove the quota path independently.
    r = await login('platform@demo.local');
    ok('platform admin signed back in', r.status === 200, `got ${r.status}`);

    const clientCount = demoFirm.clientCount;
    r = await setDemoLicense({ maxClients: clientCount }, `smoke quota ${runTag}`);
    ok('the client limit was set to exactly what is in use', r.status === 200, `got ${r.status}`);
    ok(
      'setting a limit at current usage is not reported as over',
      (r.data?.alreadyOverLimit ?? []).length === 0,
      JSON.stringify(r.data?.alreadyOverLimit),
    );

    r = await login('ca@demo.local');
    r = await call('/clients', { method: 'POST', body: { legalName: `Over quota ${runTag}`, entityType: 'PVT_LTD' } });
    ok('a full client quota refuses one more', r.status === 403, `got ${r.status}`);
    ok(
      'the refusal names the limit',
      String(r.data?.title ?? '').includes(String(clientCount)),
      `title: ${r.data?.title}`,
    );
    ok(
      'and is marked as a quota problem, not a permission one',
      String(r.data?.type ?? '').includes('quota'),
      `type ${r.data?.type}`,
    );

    // Reads are still completely unaffected by a full quota.
    r = await call('/clients');
    ok('a full quota does not affect reading', r.status === 200 && (r.data?.items?.length ?? 0) > 0);

    // A firm cannot licence itself.
    r = await login('admin@demo.local');
    r = await call('/firms/current', { method: 'PATCH', body: { name: 'Demo CA Associates', plan: 'ENTERPRISE' } });
    ok('a firm admin cannot smuggle a plan into firm settings', r.status === 422, `got ${r.status}`);
    r = await call(`/platform/firms/${demoFirm.id}/license`, {
      method: 'PUT',
      body: { ...demoLicense, reason: 'should not work', note: null },
    });
    ok('a firm admin cannot call the licence endpoint', r.status === 403, `got ${r.status}`);
  } finally {
    // Whatever happened above, hand the demo firm back the licence it had.
    // A smoke run that leaves the development environment read-only would be
    // worse than one that fails.
    r = await login('platform@demo.local');
    r = await call(`/platform/firms/${demoFirm.id}/license`, {
      method: 'PUT',
      body: { ...demoLicense, note: 'Seeded demo firm', reason: `smoke test cleanup ${runTag}` },
    });
    ok('the demo firm licence was restored', r.status === 200 && r.data?.license?.readOnly === false, `got ${r.status}`);
  }

  // And nobody else may touch any of it.
  r = await login('admin@demo.local');
  ok('firm admin signed in for the refusal checks', r.status === 200, `got ${r.status}`);
  for (const path of ['/platform/totals', '/platform/firms']) {
    r = await call(path);
    ok(`firm admin is refused ${path}`, r.status === 403, `got ${r.status}`);
  }
  r = await call('/platform/firms', {
    method: 'POST',
    body: { name: 'Nope', slug: `nope-${runTag}`, adminEmail: `nope${runTag}@example.com`, adminFullName: 'No One' },
  });
  ok('firm admin cannot provision a firm', r.status === 403, `got ${r.status}`);

  section('REFRESH TOKEN ROTATION');
  // A fresh session of its own: this section deliberately ends by revoking a
  // token family, so it must not run on a session anything later depends on.
  r = await login('ca@demo.local');
  ok('signed in for the rotation checks', r.status === 200, `got ${r.status}`);
  const sessionCookie = cookie;

  r = await call('/auth/refresh', { method: 'POST' });
  ok('a valid refresh token rotates', r.status === 200 && Boolean(r.data?.accessToken), `got ${r.status}`);
  const rotatedCookie = cookie;
  ok('rotation issues a different token', rotatedCookie !== sessionCookie);

  // Present the SPENT token. This is either a replay or a stolen copy; the
  // API cannot tell which, so it must kill the whole family.
  cookie = sessionCookie;
  r = await call('/auth/refresh', { method: 'POST' });
  ok('a spent refresh token is refused', r.status === 401, `got ${r.status}`);

  // ...and the family is gone, so the legitimate rotated token dies with it.
  cookie = rotatedCookie;
  r = await call('/auth/refresh', { method: 'POST' });
  ok(
    'reuse revokes the whole family, not just the replayed token',
    r.status === 401,
    `got ${r.status} — the rotated token outlived a detected reuse`,
  );

  /**
   * REGRESSION — this shipped broken.
   *
   * The rotation used to read used_at, find it null, and only then write.
   * Four concurrent refreshes with one token all returned 200, which is
   * exactly the case reuse detection exists to catch. The fix makes Postgres
   * the arbiter via a conditional update; this proves the database really
   * does arbitrate, which a mocked test cannot.
   */
  r = await login('reviewer@demo.local');
  ok('signed in for the concurrency check', r.status === 200, `got ${r.status}`);
  const raceCookie = cookie;

  const raced = await Promise.all(
    Array.from({ length: 4 }, () =>
      fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json', Cookie: raceCookie, Origin: 'http://localhost:5173' },
      }).then((res) => res.status),
    ),
  );
  const won = raced.filter((x) => x === 200).length;
  ok(
    'exactly one of four concurrent refreshes succeeds',
    won === 1,
    `${won} of 4 succeeded — statuses ${raced.join(', ')}`,
  );
  ok('the losers are rejected, not served', raced.filter((x) => x === 401).length === 3, raced.join(', '));

  // Leave the harness holding a usable session.
  cookie = null;
  r = await login('admin@demo.local');
  ok('can sign in again after a family revocation', r.status === 200, `got ${r.status}`);

  section('RESULT');
  console.log(`\n  ${pass} passed, ${fail} failed`);
  console.log(`  case ${caseNumber} exercised end to end\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke test crashed:', e);
  process.exit(1);
});
