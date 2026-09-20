import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LicenseView } from '@/api/endpoints';
import { ExpiryText, LicenseBanner, QuotaCell } from './license-ui';

/**
 * The licence banner, mounted for real.
 *
 * The bug worth designing against here is not a wrong colour. It is a banner
 * that says nothing when a firm is about to lose the ability to save, and a
 * banner that shouts every day for a licence that is fine — the second one
 * teaches people to ignore the first.
 */

const view = (over: Partial<LicenseView> = {}): LicenseView => ({
  plan: 'PROFESSIONAL',
  state: 'VALID',
  readOnly: false,
  expiresAt: '2027-03-31',
  daysRemaining: 200,
  graceDays: 14,
  graceDaysRemaining: null,
  limits: { users: 25, clients: 250, cases: null },
  used: { users: 5, clients: 18, cases: 41 },
  ...over,
});

describe('the licence banner', () => {
  it('says nothing at all while the licence is comfortably valid', () => {
    const { container } = render(<LicenseBanner license={view()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('warns without alarming when the end is in sight', () => {
    render(<LicenseBanner license={view({ state: 'EXPIRING_SOON', daysRemaining: 12 })} />);
    expect(screen.getByText(/ends in 12 days/i)).toBeInTheDocument();
    // Nothing has stopped working, and the banner must not imply it has.
    expect(screen.queryByText(/read-only/i)).not.toBeNull(); // it explains what comes next
    expect(screen.queryByText(/has expired/i)).toBeNull();
  });

  it('counts the grace period down in days, not in dates alone', () => {
    render(
      <LicenseBanner
        license={view({ state: 'GRACE', daysRemaining: -3, graceDaysRemaining: 11 })}
      />,
    );
    expect(screen.getByText(/11 days of grace left/i)).toBeInTheDocument();
  });

  it('uses the singular on the last day of grace', () => {
    render(
      <LicenseBanner
        license={view({ state: 'GRACE', daysRemaining: -14, graceDaysRemaining: 1 })}
      />,
    );
    expect(screen.getByText(/1 day of grace left/i)).toBeInTheDocument();
    expect(screen.queryByText(/1 days/i)).toBeNull();
  });

  it('says plainly what read-only does and does not mean', () => {
    render(<LicenseBanner license={view({ state: 'READ_ONLY', readOnly: true, daysRemaining: -30, graceDaysRemaining: 0 })} />);
    // The two things a worried user needs in the first sentence: your data is
    // here, and you can still get it out.
    expect(screen.getByText(/still here and still readable/i)).toBeInTheDocument();
    expect(screen.getByText(/export/i)).toBeInTheDocument();
  });
});

describe('quota cells', () => {
  it('shows unlimited as unlimited rather than as a big number', () => {
    render(<QuotaCell used={41} limit={null} />);
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText(/∞/)).toBeInTheDocument();
  });

  it('shows usage against the limit', () => {
    render(<QuotaCell used={18} limit={250} />);
    expect(screen.getByText(/18/)).toBeInTheDocument();
    expect(screen.getByText('/ 250')).toBeInTheDocument();
  });
});

describe('expiry text', () => {
  it('says "today" rather than "in 0 days"', () => {
    render(
      <ExpiryText
        license={{ state: 'EXPIRING_SOON', expiresAt: '2026-09-20', daysRemaining: 0, graceDaysRemaining: null }}
      />,
    );
    expect(screen.getByText('today')).toBeInTheDocument();
  });

  it('says "tomorrow" rather than "in 1 days"', () => {
    render(
      <ExpiryText
        license={{ state: 'EXPIRING_SOON', expiresAt: '2026-09-21', daysRemaining: 1, graceDaysRemaining: null }}
      />,
    );
    expect(screen.getByText('tomorrow')).toBeInTheDocument();
  });

  it('phrases a past date as time elapsed', () => {
    render(
      <ExpiryText
        license={{ state: 'READ_ONLY', expiresAt: '2026-08-14', daysRemaining: -37, graceDaysRemaining: 0 }}
      />,
    );
    expect(screen.getByText('37 days ago')).toBeInTheDocument();
  });

  it('does not invent a date for a licence that has none', () => {
    render(
      <ExpiryText license={{ state: 'VALID', expiresAt: null, daysRemaining: null, graceDaysRemaining: null }} />,
    );
    expect(screen.getByText('No end date')).toBeInTheDocument();
  });
});
