import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The popup's markup and stylesheet, checked together.
 *
 * These exist because of a bug that every other test in this repo was blind
 * to: `.panel { display: flex }` outranks the browser's `[hidden]` rule, so
 * all four views rendered stacked on top of each other — the loading message,
 * the pairing form and the fill controls at once. The JavaScript was correct
 * and the unit tests passed; the interface was unusable.
 */

const SRC = join(__dirname, '..', 'src');
const html = readFileSync(join(SRC, 'popup.html'), 'utf8');
// Comments have to go before parsing: a rule that follows one is not preceded
// by a `}`, so the naive parser skipped straight past it.
const css = readFileSync(join(SRC, 'popup.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const js = readFileSync(join(SRC, 'popup.js'), 'utf8');

/**
 * Declarations for one selector, flattened.
 *
 * Split rather than matched: a regex anchored on the preceding `}` consumes
 * that brace, so every second rule was invisible to it — which made this test
 * report a missing rule that was plainly there.
 */
function rulesFor(selector) {
  return css
    .split('}')
    .map((block) => block.split('{'))
    .filter(([sel, decls]) => sel !== undefined && decls !== undefined)
    .filter(([sel]) =>
      sel
        .split(',')
        .map((x) => x.trim())
        .includes(selector),
    )
    .map(([, decls]) => decls.trim())
    .join(';');
}

describe('the [hidden] attribute actually hides', () => {
  it('is forced to win over any layout rule', () => {
    const rule = rulesFor('[hidden]');
    expect(rule, 'no [hidden] rule in popup.css').toBeTruthy();
    expect(rule.replace(/\s+/g, ' ')).toMatch(/display:\s*none\s*!important/);
  });

  it('covers every class that both sets display and gets hidden', () => {
    // Any element carrying `hidden` in the markup, and the classes it has.
    const hiddenEls = [...html.matchAll(/<[^>]*\bhidden\b[^>]*>/g)].map((m) => m[0]);
    expect(hiddenEls.length, 'nothing in the popup uses [hidden]').toBeGreaterThan(4);

    const classes = new Set();
    for (const el of hiddenEls) {
      const cls = /class="([^"]+)"/.exec(el);
      if (cls) cls[1].split(/\s+/).forEach((c) => classes.add(c));
    }

    // Each of those classes must either not set display, or be beaten by the
    // !important rule above — which is asserted separately. This test's job
    // is to surface the collision so nobody adds one silently.
    const collisions = [...classes].filter((c) => /display\s*:/.test(rulesFor(`.${c}`)));
    expect(
      rulesFor('[hidden]').includes('!important') || collisions.length === 0,
      `classes set display and are also hidden: ${collisions.join(', ')}`,
    ).toBe(true);
  });
});

describe('the popup markup and script agree', () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

  it('only looks up elements that exist', () => {
    const looked = [...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
    const missing = [...new Set(looked)].filter((id) => !ids.has(id));
    expect(missing, 'popup.js reads ids that are not in popup.html').toEqual([]);
  });

  it('switches between exactly the views the markup declares', () => {
    const declared = [...ids].filter((id) => id.startsWith('view-')).sort();
    const switched = /for \(const id of \[([^\]]+)\]\)/.exec(js);
    expect(switched, 'show() no longer iterates a view list').toBeTruthy();

    const listed = switched[1]
      .split(',')
      .map((x) => x.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
      .sort();

    // A view in the markup but not in show() is a panel nothing can ever
    // hide — which is how they all ended up on screen together.
    expect(listed).toEqual(declared);
  });

  it('starts every view except the loading one hidden', () => {
    for (const view of [...ids].filter((id) => id.startsWith('view-'))) {
      const tag = new RegExp(`<main id="${view}"[^>]*>`).exec(html)?.[0] ?? '';
      if (view === 'view-loading') {
        expect(tag, 'the loading view should be the one visible at boot').not.toMatch(/\bhidden\b/);
      } else {
        expect(tag, `${view} is visible before the popup decides anything`).toMatch(/\bhidden\b/);
      }
    }
  });
});

describe('the popup says what it will not do', () => {
  it('states on the pairing screen that the IFP password is never taken', () => {
    expect(html).toMatch(/password is never entered here/i);
  });

  it('states beside the fill button that it never submits', () => {
    expect(html).toMatch(/never presses submit/i);
  });
});
