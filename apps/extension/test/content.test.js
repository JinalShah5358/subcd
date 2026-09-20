import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The content script is the only code that touches the portal's page, so it is
 * tested against a page rather than reasoned about.
 *
 * The fixture is deliberately hostile: it mixes the ordinary text boxes with
 * exactly the controls this extension must never touch — a password, a file
 * picker, a CAPTCHA, a submit button — and it uses the layout Indian
 * government forms actually use, with labels in a preceding table cell rather
 * than a <label for>.
 */

const SOURCE = readFileSync(join(__dirname, '..', 'src', 'content.js'), 'utf8');

const FORM = `
<form id="ifp-app">
  <table>
    <tr><td>Name of Applicant</td><td><input id="txtApplicant" name="txtApplicant" maxlength="120" required /></td></tr>
    <tr><td>PAN of the Unit</td><td><input id="txtPan" name="txtPan" maxlength="10" /></td></tr>
    <tr><td>District</td><td>
      <select id="ddlDistrict" name="ddlDistrict">
        <option value="">--Select--</option>
        <option value="24">Ahmedabad</option>
        <option value="07">Surat</option>
      </select>
    </td></tr>
    <tr><td>Date of Commercial Production</td><td><input id="txtDocp" name="txtDocp" /></td></tr>
    <tr><td>Remarks</td><td><textarea id="txtRemarks" name="txtRemarks"></textarea></td></tr>
    <tr><td>Term loan availed</td><td><input type="checkbox" id="chkTermLoan" name="chkTermLoan" /></td></tr>

    <!-- Everything below must be refused. -->
    <tr><td>Portal password</td><td><input type="password" id="txtPassword" name="txtPassword" /></td></tr>
    <tr><td>Upload sanction letter</td><td><input type="file" id="fuSanction" name="fuSanction" /></td></tr>
    <tr><td>Enter the code shown</td><td><input type="text" id="txtCaptcha" name="txtCaptchaCode" /></td></tr>
    <tr><td>Verification</td><td><div class="captcha-box"><input type="text" id="txtVerifyCode" name="verifyCode" /></div></td></tr>
    <tr><td></td><td><input type="hidden" id="__VIEWSTATE" name="__VIEWSTATE" value="abc" /></td></tr>
    <tr><td></td><td><input type="submit" id="btnSubmit" name="btnSubmit" value="Submit Application" /></td></tr>
    <tr><td></td><td><button id="btnSave" type="button">Save Draft</button></td></tr>
  </table>
</form>
`;

/** Re-evaluates content.js against the current jsdom document. */
function loadContentScript() {
  delete window.__ifpAssistant;
  // eslint-disable-next-line no-new-func
  new Function(SOURCE).call(window);
  return window.__ifpAssistant;
}

let assistant;

beforeEach(() => {
  document.body.innerHTML = FORM;
  // jsdom ships no SubtleCrypto. The portal is HTTPS and has it, so lend
  // jsdom Node's rather than testing a path that does not exist in practice.
  if (!window.crypto.subtle) {
    Object.defineProperty(window.crypto, 'subtle', {
      value: globalThis.crypto.subtle,
      configurable: true,
    });
  }
  // jsdom reports offsetParent as null for everything, which the editability
  // check reads as "hidden". Give the fixture a layout.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.ownerDocument.body;
    },
  });
  assistant = loadContentScript();
});

describe('capture — what it refuses', () => {
  it('refuses every control it must never touch', () => {
    const byLabelOrRefusal = assistant.capture();
    const refused = byLabelOrRefusal.filter((f) => f.refusedReason);

    // Password, file, captcha-by-name, captcha-by-container, hidden, submit,
    // and the plain button.
    expect(refused.length).toBeGreaterThanOrEqual(7);

    const reasons = refused.map((f) => f.refusedReason).join(' | ');
    expect(reasons).toMatch(/Password field/);
    expect(reasons).toMatch(/File upload/);
    expect(reasons).toMatch(/CAPTCHA/);
    expect(reasons).toMatch(/Hidden field/);
    expect(reasons).toMatch(/never presses one/);
  });

  it('hands back no selector for a refused control', () => {
    // This is the load-bearing part: even if a mapping row somehow named one
    // of these, there is nothing to act on.
    for (const field of assistant.capture().filter((f) => f.refusedReason)) {
      expect(field.selector).toBe('(refused)');
      expect(field.nameAttr).toBeNull();
      expect(field.idAttr).toBeNull();
    }
  });

  it('refuses a control inside a CAPTCHA widget even when its own name is innocent', () => {
    // #txtVerifyCode has nothing CAPTCHA-ish about its own name or id — the
    // only signal is the container it sits in. Without the container rule this
    // box would be treated as an ordinary text field.
    const captured = assistant.capture();
    const bare = captured.filter((f) => !f.refusedReason);

    expect(document.querySelector('#txtVerifyCode')).not.toBeNull();
    expect(
      bare.some((f) => f.idAttr === 'txtVerifyCode'),
      'a control inside a CAPTCHA widget was captured as fillable',
    ).toBe(false);

    const reasons = captured.map((f) => f.refusedReason).filter(Boolean);
    expect(reasons.some((r) => /Inside a CAPTCHA widget/.test(r))).toBe(true);
  });
});

describe('capture — what it records', () => {
  it('captures the ordinary controls with usable selectors', () => {
    const fields = assistant.capture().filter((f) => !f.refusedReason);
    const selectors = fields.map((f) => f.selector);

    expect(selectors).toContain('#txtApplicant');
    expect(selectors).toContain('#ddlDistrict');

    // Every captured selector must actually resolve to its own element.
    for (const field of fields) {
      const el = document.querySelector(field.selector);
      expect(el, `selector did not resolve: ${field.selector}`).not.toBeNull();
    }
  });

  it('reads labels out of the preceding table cell', () => {
    const pan = assistant.capture().find((f) => f.idAttr === 'txtPan');
    expect(pan?.labelText).toBe('PAN of the Unit');
  });

  it('captures select options so a value can be matched later', () => {
    const district = assistant.capture().find((f) => f.idAttr === 'ddlDistrict');
    expect(district?.controlType).toBe('select');
    expect(district?.options).toEqual([
      { value: '', label: '--Select--' },
      { value: '24', label: 'Ahmedabad' },
      { value: '07', label: 'Surat' },
    ]);
  });

  it('records maxlength and required as the page declares them', () => {
    const applicant = assistant.capture().find((f) => f.idAttr === 'txtApplicant');
    expect(applicant?.maxLength).toBe(120);
    expect(applicant?.required).toBe(true);
  });
});

describe('fill', () => {
  const plan = (over = []) => [
    { sourcePath: 'client.legalName', selector: '#txtApplicant', controlType: 'input', value: 'Shree Test Industries Pvt Ltd' },
    { sourcePath: 'client.pan', selector: '#txtPan', controlType: 'input', value: 'ABCDE1234F' },
    { sourcePath: 'project.districtCode', selector: '#ddlDistrict', controlType: 'select', value: '24' },
    ...over,
  ];

  it('fills the controls it was given', () => {
    const results = assistant.fill(plan());

    expect(document.querySelector('#txtApplicant').value).toBe('Shree Test Industries Pvt Ltd');
    expect(document.querySelector('#txtPan').value).toBe('ABCDE1234F');
    expect(document.querySelector('#ddlDistrict').value).toBe('24');
    expect(results.every((r) => r.outcome === 'FILLED')).toBe(true);
  });

  it('marks what it touched so nothing is filled invisibly', () => {
    assistant.fill(plan());
    expect(document.querySelector('#txtApplicant').getAttribute('data-ifp-filled')).toBe('yes');
  });

  it('fires input and change so the page’s own scripts see the value', () => {
    const input = document.querySelector('#txtApplicant');
    const seen = [];
    input.addEventListener('input', () => seen.push('input'));
    input.addEventListener('change', () => seen.push('change'));

    assistant.fill(plan());

    // A framework-backed form that never hears these would submit blank while
    // looking full — the worst possible failure for this tool.
    expect(seen).toEqual(['input', 'change']);
  });

  it('matches a select option by visible label when the value does not match', () => {
    const results = assistant.fill([
      { sourcePath: 'project.districtCode', selector: '#ddlDistrict', controlType: 'select', value: 'Surat' },
    ]);
    expect(document.querySelector('#ddlDistrict').value).toBe('07');
    expect(results[0].outcome).toBe('FILLED');
  });

  it('uses the mapping’s option map when our value differs from the portal’s', () => {
    assistant.fill([
      {
        sourcePath: 'project.districtCode',
        selector: '#ddlDistrict',
        controlType: 'select',
        value: 'GJ-AHM',
        optionMap: { 'GJ-AHM': '24' },
      },
    ]);
    expect(document.querySelector('#ddlDistrict').value).toBe('24');
  });

  it('reports rather than guesses when no option matches', () => {
    const results = assistant.fill([
      { sourcePath: 'project.districtCode', selector: '#ddlDistrict', controlType: 'select', value: 'Vadodara' },
    ]);
    expect(results[0].outcome).toBe('OPTION_NOT_FOUND');
    expect(document.querySelector('#ddlDistrict').value).toBe('');
  });

  it('reports a control that is no longer on the page', () => {
    const results = assistant.fill([
      { sourcePath: 'client.legalName', selector: '#gone', controlType: 'input', value: 'x' },
    ]);
    expect(results[0].outcome).toBe('MISSING');
  });

  it('leaves disabled and readonly controls alone', () => {
    document.querySelector('#txtPan').disabled = true;
    document.querySelector('#txtRemarks').readOnly = true;

    const results = assistant.fill([
      { sourcePath: 'client.pan', selector: '#txtPan', controlType: 'input', value: 'ABCDE1234F' },
      { sourcePath: 'client.notes', selector: '#txtRemarks', controlType: 'textarea', value: 'hi' },
    ]);

    expect(results.map((r) => r.outcome)).toEqual(['NOT_EDITABLE', 'NOT_EDITABLE']);
    expect(document.querySelector('#txtPan').value).toBe('');
  });

  /**
   * The rule that matters most.
   *
   * A mapping is data. If a bad or tampered mapping named the password box or
   * the submit button, the fill step must refuse on the LIVE element rather
   * than trusting what it was told.
   */
  it('refuses a plan that points at a password, file, CAPTCHA or submit control', () => {
    const results = assistant.fill([
      { sourcePath: 'evil.password', selector: '#txtPassword', controlType: 'input', value: 'hunter2' },
      { sourcePath: 'evil.file', selector: '#fuSanction', controlType: 'input', value: 'C:/x.pdf' },
      { sourcePath: 'evil.captcha', selector: '#txtCaptcha', controlType: 'input', value: '4821' },
      { sourcePath: 'evil.submit', selector: '#btnSubmit', controlType: 'input', value: 'go' },
    ]);

    expect(results.map((r) => r.outcome)).toEqual(['REFUSED', 'REFUSED', 'REFUSED', 'REFUSED']);
    expect(document.querySelector('#txtPassword').value).toBe('');
    expect(document.querySelector('#txtCaptcha').value).toBe('');
  });

  it('never submits the form', () => {
    const form = document.querySelector('#ifp-app');
    const onSubmit = vi.fn((e) => e.preventDefault());
    form.addEventListener('submit', onSubmit);
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit');
    const btnClick = vi.spyOn(document.querySelector('#btnSubmit'), 'click');

    assistant.fill(
      plan([
        { sourcePath: 'evil.submit', selector: '#btnSubmit', controlType: 'input', value: 'go' },
        { sourcePath: 'case.termLoan', selector: '#chkTermLoan', controlType: 'checkbox', value: 'true' },
      ]),
    );

    expect(onSubmit).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
    expect(btnClick).not.toHaveBeenCalled();
  });

  it('ticks a checkbox without clicking anything else', () => {
    assistant.fill([
      { sourcePath: 'loan.isTermLoan', selector: '#chkTermLoan', controlType: 'checkbox', value: 'true' },
    ]);
    expect(document.querySelector('#chkTermLoan').checked).toBe(true);
  });
});

describe('clearMarks', () => {
  it('removes every highlight it added', () => {
    assistant.fill([
      { sourcePath: 'client.legalName', selector: '#txtApplicant', controlType: 'input', value: 'x' },
    ]);
    expect(document.querySelectorAll('[data-ifp-filled]').length).toBeGreaterThan(0);

    assistant.clearMarks();
    expect(document.querySelectorAll('[data-ifp-filled]').length).toBe(0);
    expect(document.getElementById('ifp-assistant-style')).toBeNull();
  });
});

describe('fingerprint', () => {
  it('is a SHA-256 that changes only when the form shape changes', async () => {
    const before = await assistant.fingerprint();
    expect(before).toMatch(/^[0-9a-f]{64}$/);

    // Typing a value is not a change of shape.
    assistant.fill([
      { sourcePath: 'client.legalName', selector: '#txtApplicant', controlType: 'input', value: 'x' },
    ]);
    expect(await assistant.fingerprint()).toBe(before);

    document.querySelector('#txtPan').remove();
    expect(await assistant.fingerprint()).not.toBe(before);
  });

  it('uses the same key formula the server stores', () => {
    // The two used to disagree, so an unchanged page reported drift on every
    // run — and a warning that cries wolf is one people learn to click past.
    const fields = assistant.capture();
    const keys = assistant.fingerprintKeys(fields);

    const serverSide = fields
      .map((f) => `${f.controlType}|${f.inputType ?? ''}|${f.nameAttr ?? ''}|${f.idAttr ?? ''}`)
      .sort();

    expect(keys).toEqual(serverSide);
  });

  it('returns null rather than a digest that could never match', async () => {
    const real = window.crypto.subtle;
    Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      expect(await assistant.fingerprint()).toBeNull();
    } finally {
      Object.defineProperty(window.crypto, 'subtle', { value: real, configurable: true });
    }
  });
});
