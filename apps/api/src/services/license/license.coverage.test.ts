import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every route that can change tenant data is behind the licence guard.
 *
 * This is the same kind of test as `tenant.registry.test.ts`, for the same
 * reason. The bug it exists to catch is not a wrong guard — it is a router
 * added six months from now by somebody who has never read this file, mounted
 * in `app.ts`, and never given the guard at all. That router would work
 * perfectly in every test anyone thinks to write for it.
 *
 * So the check is structural: enumerate what is mounted, and insist.
 */

const MODULES = join(__dirname, '..', '..', 'modules');

/** Routers that legitimately have no licence guard, and why. */
const EXEMPT: Record<string, string> = {
  // Signing in, refreshing and redeeming an invitation must keep working for a
  // firm whose licence lapsed — read-only means read-only, not locked out.
  auth: 'authentication must work for a read-only firm',
  // Cross-tenant administration. A platform admin setting a licence cannot be
  // refused by the licence they are setting.
  platform: 'platform administration is not firm-scoped',
};

/**
 * The extension router authenticates per route rather than router-wide, so it
 * is checked differently: every non-GET route on it must name the guard.
 */
const PER_ROUTE = new Set(['extension']);

function moduleSource(name: string): string {
  const dir = join(MODULES, name);
  const file = readdirSync(dir).find((f) => f.endsWith('.routes.ts'));
  if (!file) throw new Error(`no .routes.ts in ${name}`);
  return readFileSync(join(dir, file), 'utf8');
}

const MODULE_NAMES = readdirSync(MODULES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe('the licence guard is mounted where it has to be', () => {
  it('finds the routers at all', () => {
    // If this fails the directory moved and every assertion below became
    // vacuous, which is the failure mode a coverage test must not have.
    expect(MODULE_NAMES.length).toBeGreaterThan(5);
    expect(MODULE_NAMES).toContain('clients');
    expect(MODULE_NAMES).toContain('cases');
  });

  for (const name of MODULE_NAMES) {
    if (EXEMPT[name] || PER_ROUTE.has(name)) continue;

    it(`${name} mounts enforceLicense() right after authenticate()`, () => {
      const src = moduleSource(name);
      const authAt = src.indexOf('.use(authenticate());');
      expect(authAt, `${name} does not authenticate at the router level`).toBeGreaterThan(-1);

      const guardAt = src.indexOf('.use(enforceLicense());');
      expect(guardAt, `${name} has no router-level licence guard`).toBeGreaterThan(-1);

      // After authentication, because the guard reads the firm from the auth
      // context and would otherwise throw on every request instead of
      // checking one.
      expect(guardAt).toBeGreaterThan(authAt);
    });
  }

  it('gates every write route on the extension router', () => {
    const src = moduleSource('extension');

    // Split on the route declarations so each block holds exactly one route's
    // middleware list.
    const blocks = src.split(/extensionRouter\./).slice(1);
    const writes = blocks.filter((b) => /^(post|put|patch|delete)\(/.test(b));
    expect(writes.length, 'no write routes found — the parser broke').toBeGreaterThan(5);

    const ungated = writes
      .map((b) => {
        const head = b.slice(0, b.indexOf('handler('));
        const path = /'([^']+)'/.exec(head)?.[1] ?? '?';
        return { path, head };
      })
      // Pairing is the one write with no firm yet: the pairing code IS the
      // credential, and there is nothing to read a licence from.
      .filter((r) => r.path !== '/pair')
      .filter((r) => !r.head.includes('enforceLicense()'))
      .map((r) => r.path);

    expect(ungated, 'extension write routes with no licence guard').toEqual([]);
  });

  it('exempts nothing that was not deliberately exempted', () => {
    // A name added to EXEMPT must still exist, or the exemption is silently
    // covering for a router that was renamed.
    for (const name of Object.keys(EXEMPT)) {
      expect(MODULE_NAMES, `EXEMPT names '${name}', which is not a module`).toContain(name);
    }
  });
});
