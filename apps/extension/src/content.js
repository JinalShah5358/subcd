/**
 * The page-facing half. Runs only when the CA clicks something in the popup.
 *
 * It can do exactly three things: describe the form controls it can see, type
 * values into named controls, and mark what it touched.
 *
 * It cannot submit. Not "does not" — cannot: there is no call to submit(), no
 * click on a submit control, and no synthetic submit event anywhere in this
 * file, and the refusal list below makes submit controls unreachable by
 * selector too. If that ever needs to change, it changes here, in public, in a
 * diff someone has to approve.
 *
 * It also never reads a password field, a file input, or anything
 * CAPTCHA-shaped — not to fill, and not even to describe.
 */

(() => {
  if (window.__ifpAssistant) return;

  const MARK_ATTR = 'data-ifp-filled';
  const STYLE_ID = 'ifp-assistant-style';

  /* ----------------------------- refusals ------------------------------ */

  const REFUSED_INPUT_TYPES = new Set(['password', 'file', 'hidden', 'submit', 'button', 'image', 'reset']);
  const CAPTCHA_HINT = /captcha|recaptcha|hcaptcha|turnstile|securimage|verificationcode|verify_code/i;

  /**
   * Why this control will not be touched, or null if it is fair game.
   *
   * Returning a reason rather than silently skipping matters: the CA gets a
   * list of what was deliberately left alone, so an empty box is never a
   * mystery they have to debug.
   */
  function refusalReason(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const idish = `${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`;

    if (tag === 'input' && REFUSED_INPUT_TYPES.has(type)) {
      if (type === 'password') return 'Password field — never read or filled';
      if (type === 'file') return 'File upload — the CA attaches documents themselves';
      if (type === 'hidden') return 'Hidden field — not user-editable';
      return 'Button or submit control — this extension never presses one';
    }
    if (tag === 'button') return 'Button — this extension never presses one';

    if (CAPTCHA_HINT.test(idish) || CAPTCHA_HINT.test(labelFor(el) || '')) {
      return 'CAPTCHA — solving or bypassing one is not something this tool does';
    }

    // A control inside a CAPTCHA widget's container.
    if (el.closest('[class*="captcha" i], [id*="captcha" i]')) {
      return 'Inside a CAPTCHA widget — left entirely alone';
    }

    return null;
  }

  /* ---------------------------- descriptions --------------------------- */

  /**
   * The best human name for a control.
   *
   * The label is what a CA reads when deciding which of our fields belongs in
   * this box, so a wrong one is not cosmetic. Two failures were worth fixing:
   * a control wrapped in its own <div> inside a table cell picked up nothing,
   * and a button in a footer picked up the entire preceding table's text.
   */
  function labelFor(el) {
    if (el.id) {
      const byFor = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (byFor?.textContent) return clean(byFor.textContent);
    }
    const wrapping = el.closest('label');
    if (wrapping?.textContent) return clean(wrapping.textContent);

    const aria = el.getAttribute('aria-label') || el.getAttribute('title');
    if (aria) return clean(aria);

    // The cell to the left, which is how most government forms are laid out.
    // Walk out to the enclosing cell rather than stopping at an inner <div>,
    // or a control inside a wrapper gets no label at all.
    const cell = el.closest('td, th');
    const prev = cell?.previousElementSibling;
    if (prev && isLabelish(prev)) return clean(prev.textContent);

    // Failing that, the cell's own text minus this control's.
    if (cell && isLabelish(cell)) {
      const own = clean(cell.textContent);
      if (own) return own;
    }

    // Buttons carry their name on their face.
    const face = el.value || el.textContent;
    if ((el.tagName === 'BUTTON' || el.type === 'submit' || el.type === 'button') && face) {
      return clean(face);
    }

    return el.getAttribute('placeholder') ? clean(el.getAttribute('placeholder')) : null;
  }

  /** Text that describes a field, rather than a container full of other fields. */
  function isLabelish(node) {
    if (!node?.textContent?.trim()) return false;
    // A "label" holding its own inputs is a layout container, not a label.
    if (node.querySelector?.('input, select, textarea, button')) return false;
    return clean(node.textContent).length <= 250;
  }

  const clean = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 250);

  function cssEscape(value) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(value);
    return String(value).replace(/["\\#.:>~+*[\]()]/g, '\\$&');
  }

  /**
   * A selector for this exact control.
   *
   * Prefers id, then name scoped by tag, then a nth-of-type path. Captured
   * from the live page — never guessed, and never reused across pages.
   */
  function selectorFor(el) {
    if (el.id && document.querySelectorAll(`#${cssEscape(el.id)}`).length === 1) {
      return `#${cssEscape(el.id)}`;
    }
    if (el.name) {
      const byName = document.querySelectorAll(
        `${el.tagName.toLowerCase()}[name="${cssEscape(el.name)}"]`,
      );
      if (byName.length === 1) return `${el.tagName.toLowerCase()}[name="${cssEscape(el.name)}"]`;
      // Radio groups legitimately share a name; disambiguate by value.
      if (el.type === 'radio' && el.value) {
        return `${el.tagName.toLowerCase()}[name="${cssEscape(el.name)}"][value="${cssEscape(el.value)}"]`;
      }
    }

    const path = [];
    let node = el;
    while (node && node.nodeType === 1 && path.length < 8) {
      const tag = node.tagName.toLowerCase();
      if (node.id) {
        path.unshift(`#${cssEscape(node.id)}`);
        break;
      }
      const parent = node.parentElement;
      if (!parent) {
        path.unshift(tag);
        break;
      }
      const sameTag = [...parent.children].filter((c) => c.tagName === node.tagName);
      path.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
      node = parent;
    }
    return path.join(' > ');
  }

  function controlKind(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'radio') return 'radio';
    if (type === 'checkbox') return 'checkbox';
    return 'input';
  }

  const isEditable = (el) =>
    !el.disabled &&
    !el.readOnly &&
    el.offsetParent !== null &&
    getComputedStyle(el).visibility !== 'hidden';

  /* ------------------------------ capture ------------------------------ */

  function capture() {
    const elements = [...document.querySelectorAll('input, select, textarea, button')];
    const out = [];

    for (const el of elements) {
      const reason = refusalReason(el);
      const kind = controlKind(el);

      if (reason) {
        // Recorded so the CA can see the box exists and why it is untouched —
        // with no selector, so nothing downstream can act on it.
        out.push({
          selector: '(refused)',
          controlType: kind,
          inputType: (el.getAttribute('type') || '').toLowerCase() || null,
          labelText: labelFor(el),
          nameAttr: null,
          idAttr: null,
          required: false,
          maxLength: null,
          options: null,
          refusedReason: reason,
        });
        continue;
      }

      const options =
        el.tagName.toLowerCase() === 'select'
          ? [...el.options].slice(0, 2000).map((o) => ({
              value: String(o.value).slice(0, 300),
              label: clean(o.textContent || '').slice(0, 300),
            }))
          : null;

      out.push({
        selector: selectorFor(el),
        controlType: kind,
        inputType: (el.getAttribute('type') || '').toLowerCase() || null,
        labelText: labelFor(el),
        nameAttr: el.name || null,
        idAttr: el.id || null,
        required: Boolean(el.required),
        maxLength: el.maxLength && el.maxLength > 0 ? el.maxLength : null,
        options,
        refusedReason: null,
      });
    }

    return out;
  }

  /**
   * A digest of the form's SHAPE, used to notice the portal changing.
   *
   * Derived from capture(), because the server computes the stored
   * fingerprint from exactly the array capture() posts. Two formulas over two
   * slightly different field sets disagreed on every run — which reported
   * "the portal has changed" on a page that had not changed at all, and a
   * warning that cries wolf is one people learn to click past.
   */
  function fingerprint() {
    return sha256Hex(fingerprintKeys(capture()).join('\n'));
  }

  /** The canonical key list. The server derives the identical list. */
  function fingerprintKeys(fields) {
    return fields
      .map((f) => `${f.controlType}|${f.inputType ?? ''}|${f.nameAttr ?? ''}|${f.idAttr ?? ''}`)
      .sort();
  }

  /**
   * SHA-256, or nothing.
   *
   * There used to be a djb2 fallback here for contexts without SubtleCrypto.
   * It was worse than useless: an 8-character digest can never equal the
   * server's 64-character SHA-256, so every run would report "the portal has
   * changed" on a page that had not. Returning null instead means the server
   * skips the drift check — "we could not tell" is the honest answer, and it
   * does not train anyone to ignore a real warning.
   *
   * The portal is HTTPS, so crypto.subtle is available in practice.
   */
  async function sha256Hex(text) {
    if (!crypto?.subtle) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /* -------------------------------- fill ------------------------------- */

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${MARK_ATTR}="yes"] {
        outline: 2px solid #1d7a3e !important;
        outline-offset: 1px !important;
        background-color: rgba(29, 122, 62, 0.06) !important;
      }
      [${MARK_ATTR}="no"] {
        outline: 2px dashed #b45309 !important;
        outline-offset: 1px !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  /**
   * Sets a value the way a user would, so the page's own scripts react.
   *
   * React and Angular ignore a plain `el.value = x`, which would leave the
   * portal's own model out of step with what the CA can see — the worst
   * possible outcome: a form that LOOKS filled and submits blank.
   */
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function matchOption(select, value, optionMap) {
    const wanted = optionMap?.[value] ?? value;
    const lower = String(wanted).toLowerCase().trim();

    for (const opt of select.options) {
      if (String(opt.value).toLowerCase().trim() === lower) return opt.value;
    }
    for (const opt of select.options) {
      if (clean(opt.textContent || '').toLowerCase() === lower) return opt.value;
    }
    return null;
  }

  function fill(plan) {
    ensureStyle();
    const results = [];

    for (const item of plan) {
      const base = { sourcePath: item.sourcePath, selector: item.selector };
      let el = null;
      try {
        el = document.querySelector(item.selector);
      } catch {
        results.push({ ...base, outcome: 'MISSING', detail: 'Selector is no longer valid' });
        continue;
      }

      if (!el) {
        results.push({ ...base, outcome: 'MISSING', detail: 'Not on this page' });
        continue;
      }

      // Re-check the refusal rules against the LIVE element. The mapping was
      // reviewed once; the page is whatever it is right now.
      const reason = refusalReason(el);
      if (reason) {
        el.setAttribute(MARK_ATTR, 'no');
        results.push({ ...base, outcome: 'REFUSED', detail: reason });
        continue;
      }

      if (!isEditable(el)) {
        el.setAttribute(MARK_ATTR, 'no');
        results.push({ ...base, outcome: 'NOT_EDITABLE', detail: 'Disabled, readonly or hidden' });
        continue;
      }

      try {
        if (el.tagName.toLowerCase() === 'select') {
          const optionValue = matchOption(el, item.value, item.optionMap);
          if (optionValue === null) {
            el.setAttribute(MARK_ATTR, 'no');
            results.push({
              ...base,
              outcome: 'OPTION_NOT_FOUND',
              detail: 'No option matched the prepared value',
            });
            continue;
          }
          setNativeValue(el, optionValue);
        } else if (el.type === 'checkbox') {
          const truthy = ['true', 'yes', 'y', '1'].includes(String(item.value).toLowerCase());
          if (el.checked !== truthy) el.click();
        } else if (el.type === 'radio') {
          if (!el.checked) el.click();
        } else {
          setNativeValue(el, item.value);
        }

        el.setAttribute(MARK_ATTR, 'yes');
        results.push({ ...base, outcome: 'FILLED' });
      } catch (err) {
        el.setAttribute(MARK_ATTR, 'no');
        results.push({ ...base, outcome: 'MISSING', detail: String(err?.message ?? err).slice(0, 250) });
      }
    }

    return results;
  }

  function clearMarks() {
    for (const el of document.querySelectorAll(`[${MARK_ATTR}]`)) el.removeAttribute(MARK_ATTR);
    document.getElementById(STYLE_ID)?.remove();
    return { cleared: true };
  }

  window.__ifpAssistant = { capture, fill, fingerprint, fingerprintKeys, clearMarks };
})();
