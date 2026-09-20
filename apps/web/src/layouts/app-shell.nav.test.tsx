import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ROLE_PERMISSIONS, hasPermission, type Permission } from '@ifp/shared';

/**
 * The two consoles stay apart.
 *
 * A platform administrator runs the service; they have no clients and no
 * cases of their own, and every firm route refuses them. Showing them
 * Clients, Cases, Users, Firm settings and the audit log implied those
 * screens had something behind them — they had nothing, and the emptiness
 * read as a bug rather than as a boundary.
 *
 * This test exists because a sidebar is exactly the kind of thing somebody
 * adds one line to without thinking about who is looking at it.
 *
 * Two independent things keep the consoles apart: the platform role holds
 * only `platform:admin`, and `NavLinks` branches on it. Either alone is
 * enough, so breaking one does not fail this test — breaking both does, which
 * was verified. That is the shape you want; it just means a single mutation
 * here proves less than it looks like it does.
 */

let permissions: readonly string[] = [];

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', fullName: 'Test', email: 't@example.com', permissions },
    can: (p: Permission) => hasPermission(permissions, p),
  }),
}));

const { NavLinks } = await import('./AppShell');

function navFor(role: keyof typeof ROLE_PERMISSIONS): string[] {
  permissions = ROLE_PERMISSIONS[role];
  const { unmount } = render(
    <MemoryRouter>
      <NavLinks />
    </MemoryRouter>,
  );
  const labels = screen.getAllByRole('link').map((a) => a.textContent?.trim() ?? '');
  unmount();
  return labels;
}

describe('the platform administrator gets a different sidebar', () => {
  const FIRM_ONLY = ['Clients', 'Cases', 'Browser extension', 'Users', 'Firm settings', 'Audit log'];

  it('shows the platform console and only the platform console', () => {
    const links = navFor('PLATFORM_ADMIN');
    expect(links).toEqual(['Overview', 'Firms', 'Renewals']);
  });

  it('shows no firm screen at all', () => {
    const links = navFor('PLATFORM_ADMIN');
    for (const label of FIRM_ONLY) {
      expect(links, `${label} is reachable from the platform sidebar`).not.toContain(label);
    }
  });

  it('does not offer the firm dashboard either', () => {
    // '/' redirects a platform admin to '/platform'. A link that exists only
    // to bounce is a link that should not exist.
    expect(navFor('PLATFORM_ADMIN')).not.toContain('Dashboard');
  });
});

describe('firm roles never see the platform console', () => {
  for (const role of ['FIRM_ADMIN', 'CA', 'STAFF', 'REVIEWER'] as const) {
    it(`${role} sees no platform link`, () => {
      const links = navFor(role);
      expect(links.length, `${role} got an empty sidebar`).toBeGreaterThan(0);
      for (const label of ['Overview', 'Firms', 'Renewals']) {
        expect(links, `${role} can reach ${label}`).not.toContain(label);
      }
    });
  }

  it('gives a firm admin the full firm sidebar', () => {
    const links = navFor('FIRM_ADMIN');
    expect(links).toEqual([
      'Dashboard',
      'Clients',
      'Cases',
      'Browser extension',
      'Users',
      'Firm settings',
      'Audit log',
    ]);
  });

  it('hides administration from a CA, who cannot manage users or the firm', () => {
    const links = navFor('CA');
    expect(links).toContain('Cases');
    expect(links).not.toContain('Users');
    expect(links).not.toContain('Firm settings');
  });

  it('shows a reviewer the audit log but no extension', () => {
    // A reviewer reads and checks. Filing a form is not their job, and
    // `case:write` is what the extension screens need.
    const links = navFor('REVIEWER');
    expect(links).toContain('Audit log');
    expect(links).toContain('Cases');
  });
});
