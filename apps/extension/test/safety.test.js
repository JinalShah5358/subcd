import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The product constraints, checked against the source rather than trusted.
 *
 * Every one of these is a promise made to a CA whose professional licence is
 * attached to what this tool does on a government portal. A behavioural test
 * proves the code does not submit *today*, for the paths it exercises; this
 * proves the capability is not in the file at all, so it cannot be reached by
 * some path nobody thought to test.
 *
 * If one of these fails, the fix is almost never to relax the test.
 */

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

const sources = readdirSync(SRC)
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ name: f, code: readFileSync(join(SRC, f), 'utf8') }));

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

/** Strips comments so a rule named in prose is not mistaken for code. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const executable = sources.map((s) => ({ ...s, code: stripComments(s.code) }));

/**
 * The actual contents of the refusal set, parsed rather than grepped.
 *
 * A nearby-text regex passed even with 'password' removed from the set,
 * because the word still appeared a few lines away in the reason message. A
 * test that cannot tell those apart is not testing anything.
 */
function refusedInputTypes() {
  const content = executable.find((s) => s.name === 'content.js').code;
  const m = /REFUSED_INPUT_TYPES\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(content);
  if (!m) throw new Error('REFUSED_INPUT_TYPES set not found in content.js');
  return m[1]
    .split(',')
    .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

describe('the extension cannot submit a form', () => {
  it('calls no submit() anywhere', () => {
    for (const { name, code } of executable) {
      expect(code, `${name} contains a submit() call`).not.toMatch(/\.submit\s*\(/);
      expect(code, `${name} constructs a submit event`).not.toMatch(
        /new\s+(Submit)?Event\s*\(\s*['"]submit['"]/,
      );
      expect(code, `${name} requests form submission`).not.toMatch(/requestSubmit\s*\(/);
    }
  });

  it('clicks nothing but the checkbox and radio controls it is allowed to toggle', () => {
    const content = executable.find((s) => s.name === 'content.js').code;
    const clicks = [...content.matchAll(/(\w+)\.click\s*\(\s*\)/g)].map((m) => m[0]);

    // Two, and only two: the checkbox branch and the radio branch. A click on
    // anything else is how a "filler" quietly becomes a submitter.
    expect(clicks).toEqual(['el.click()', 'el.click()']);

    const checkboxBranch = /el\.type === 'checkbox'[\s\S]{0,300}?el\.click\(\)/.test(content);
    const radioBranch = /el\.type === 'radio'[\s\S]{0,200}?el\.click\(\)/.test(content);
    expect(checkboxBranch && radioBranch).toBe(true);
  });

  it('refuses submit and button controls by type', () => {
    const types = refusedInputTypes();
    expect(types).toContain('submit');
    expect(types).toContain('button');
    expect(types).toContain('image');
    expect(types).toContain('reset');
  });
});

describe('the extension never touches credentials or CAPTCHA', () => {
  it('refuses password, file and hidden inputs', () => {
    const types = refusedInputTypes();
    for (const type of ['password', 'file', 'hidden']) {
      expect(types, `${type} is not in the refusal set`).toContain(type);
    }
  });

  it('matches CAPTCHA by name, by label and by container', () => {
    const content = executable.find((s) => s.name === 'content.js').code;
    expect(content).toMatch(/captcha/i);
    expect(content, 'no container-based CAPTCHA check').toMatch(
      /closest\([^)]*captcha[^)]*\)/i,
    );
  });

  it('reads no cookies and no storage belonging to the portal', () => {
    for (const { name, code } of executable) {
      expect(code, `${name} reads document.cookie`).not.toMatch(/document\.cookie/);
      expect(code, `${name} uses the cookies API`).not.toMatch(/chrome\.cookies/);
      // localStorage/sessionStorage in a content script belong to the PAGE.
      expect(code, `${name} reads page storage`).not.toMatch(/\b(localStorage|sessionStorage)\b/);
    }
  });

  it('sends no field value back to the platform', () => {
    const background = executable.find((s) => s.name === 'background.js').code;
    // The outcome payload is built from the content script's results, which
    // carry sourcePath/selector/outcome/detail and no value. Assert the
    // request body shape names nothing else.
    expect(background).toMatch(/body:\s*\{\s*status:[^}]*outcomes\s*\}/);
    expect(background, 'a value field appears in a telemetry body').not.toMatch(
      /outcomes[\s\S]{0,200}value:/,
    );
  });
});

describe('the extension runs only where and when it is told', () => {
  it('asks for no wildcard host', () => {
    for (const host of manifest.host_permissions) {
      expect(host, 'wildcard host permission').not.toMatch(/<all_urls>/);
      expect(host, 'wildcard scheme or host').not.toMatch(/^\*:\/\/\*\//);
      expect(host).toMatch(/^https?:\/\/[a-z0-9.\-:]+\//i);
    }
    expect(manifest.host_permissions).toContain('https://ifp.gujarat.gov.in/*');
  });

  it('declares no content script that would run on page load', () => {
    // Injection happens through chrome.scripting on a click in the popup.
    // A declarative content_scripts block would run without one.
    expect(manifest.content_scripts).toBeUndefined();
  });

  it('asks for no permission beyond what the flow needs', () => {
    expect(manifest.permissions.sort()).toEqual(['activeTab', 'scripting', 'storage']);
    for (const risky of ['tabs', 'webRequest', 'webRequestBlocking', 'cookies', 'history', 'downloads']) {
      expect(manifest.permissions, `asks for ${risky}`).not.toContain(risky);
    }
  });

  it('registers no alarm, timer or navigation hook that could act unattended', () => {
    for (const { name, code } of executable) {
      expect(code, `${name} sets an alarm`).not.toMatch(/chrome\.alarms/);
      expect(code, `${name} hooks navigation`).not.toMatch(/chrome\.webNavigation/);
      expect(code, `${name} hooks requests`).not.toMatch(/chrome\.webRequest/);
      expect(code, `${name} auto-runs on a timer`).not.toMatch(/setInterval\s*\(/);
    }
  });

  it('executes nothing it received over the network', () => {
    for (const { name, code } of executable) {
      expect(code, `${name} uses eval`).not.toMatch(/\beval\s*\(/);
      expect(code, `${name} builds a function from a string`).not.toMatch(/new\s+Function\s*\(/);
      expect(code, `${name} imports at runtime`).not.toMatch(/import\s*\(/);
    }
    expect(manifest.content_security_policy.extension_pages).toMatch(/script-src 'self'/);
  });
});

describe('the manifest is what a reviewer would expect', () => {
  it('is MV3 with a versioned name and an options page', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.options_page).toBeTruthy();
  });

  it('references only files that exist', () => {
    const files = new Set(readdirSync(SRC).map((f) => `src/${f}`));
    for (const icon of Object.values(manifest.icons)) {
      expect(readdirSync(join(ROOT, 'icons'))).toContain(icon.split('/').pop());
    }
    expect(files).toContain(manifest.background.service_worker);
    expect(files).toContain(manifest.action.default_popup);
    expect(files).toContain(manifest.options_page);
  });

  it('says plainly in its description that submission stays with the CA', () => {
    expect(manifest.description.toLowerCase()).toMatch(/ca|submission|review/);
  });
});
