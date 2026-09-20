import { describe, expect, it } from 'vitest';
import {
  EXPIRY_WARNING_DAYS,
  LICENSE_PLANS,
  PLAN_DEFAULTS,
  defaultExpiryFor,
  licenseStatus,
  quotaExceeded,
  quotaLimit,
  quotaMessage,
  type LicenseFields,
} from './license';

/**
 * The licence state machine.
 *
 * Two things make this worth testing carefully rather than eyeballing. The
 * boundaries are where the money is — a firm refused one day early is a
 * support call, and a firm allowed one day late is revenue — and the dates are
 * evaluated in IST while the stored value is a UTC-midnight DATE, which is
 * exactly the kind of arithmetic that works in London and fails in Ahmedabad.
 */

const base: LicenseFields = {
  plan: 'PROFESSIONAL',
  expiresAt: null,
  graceDays: 7,
  maxUsers: 25,
  maxClients: 250,
  maxCases: null,
};

/** A DATE column as Prisma returns it: midnight UTC on that day. */
const dateCol = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** An instant, given as an IST wall-clock time. IST is UTC+5:30, no DST. */
const ist = (iso: string, hhmm = '12:00') => new Date(`${iso}T${hhmm}:00.000+05:30`);

describe('a licence with no end date', () => {
  it('is valid and stays valid', () => {
    const s = licenseStatus(base, ist('2099-01-01'));
    expect(s.state).toBe('VALID');
    expect(s.readOnly).toBe(false);
    expect(s.expiresAt).toBeNull();
    expect(s.daysRemaining).toBeNull();
  });

  it('treats an unparseable date as no date rather than as expired', () => {
    // A firm should not lose write access because a column came back odd.
    const s = licenseStatus({ ...base, expiresAt: 'not-a-date' }, ist('2027-01-01'));
    expect(s.state).toBe('VALID');
    expect(s.readOnly).toBe(false);
  });
});

describe('the boundaries around expiry', () => {
  const fields = { ...base, expiresAt: dateCol('2027-03-31'), graceDays: 7 };

  it('is plainly valid well before the date', () => {
    const s = licenseStatus(fields, ist('2026-06-01'));
    expect(s.state).toBe('VALID');
    expect(s.daysRemaining).toBeGreaterThan(EXPIRY_WARNING_DAYS);
  });

  it('starts warning exactly 30 days out, not 31', () => {
    expect(licenseStatus(fields, ist('2027-02-28')).state).toBe('VALID'); // 31 days
    expect(licenseStatus(fields, ist('2027-03-01')).state).toBe('EXPIRING_SOON'); // 30 days
  });

  it('is still writable on the expiry date itself, all day', () => {
    for (const time of ['00:00', '12:00', '23:59']) {
      const s = licenseStatus(fields, ist('2027-03-31', time));
      expect(s.daysRemaining, `at ${time} IST`).toBe(0);
      expect(s.readOnly, `at ${time} IST`).toBe(false);
      expect(s.state).toBe('EXPIRING_SOON');
    }
  });

  it('does not expire at half past five in the morning', () => {
    // 2027-03-31 23:00 IST is 2027-03-31 17:30 UTC — same day either way. The
    // case that catches naive arithmetic is the small hours: 01:00 IST on the
    // 31st is 19:30 UTC on the 30th.
    expect(licenseStatus(fields, ist('2027-03-31', '01:00')).daysRemaining).toBe(0);
    expect(licenseStatus(fields, ist('2027-04-01', '01:00')).daysRemaining).toBe(-1);
  });

  it('enters grace the day after, not the day of', () => {
    const s = licenseStatus(fields, ist('2027-04-01'));
    expect(s.state).toBe('GRACE');
    expect(s.readOnly).toBe(false);
    expect(s.daysRemaining).toBe(-1);
    expect(s.graceDaysRemaining).toBe(7);
  });

  it('counts the grace period down to its last day', () => {
    expect(licenseStatus(fields, ist('2027-04-07')).graceDaysRemaining).toBe(1);
    expect(licenseStatus(fields, ist('2027-04-07')).state).toBe('GRACE');
    expect(licenseStatus(fields, ist('2027-04-07')).readOnly).toBe(false);
  });

  it('goes read-only the day after grace runs out', () => {
    const s = licenseStatus(fields, ist('2027-04-08'));
    expect(s.state).toBe('READ_ONLY');
    expect(s.readOnly).toBe(true);
    expect(s.graceDaysRemaining).toBe(0);
  });

  it('goes read-only immediately when there is no grace at all', () => {
    const noGrace = { ...fields, graceDays: 0 };
    expect(licenseStatus(noGrace, ist('2027-03-31')).readOnly).toBe(false);
    expect(licenseStatus(noGrace, ist('2027-04-01')).readOnly).toBe(true);
  });

  it('reports the expiry date back unchanged', () => {
    expect(licenseStatus(fields, ist('2027-01-01')).expiresAt).toBe('2027-03-31');
  });
});

describe('quotas', () => {
  it('treats null as unlimited', () => {
    expect(quotaExceeded(0, null)).toBe(false);
    expect(quotaExceeded(9_999_999, null)).toBe(false);
  });

  it('allows the last one in, and refuses the one after', () => {
    // The off-by-one here is the difference between a firm getting the tenth
    // client they paid for and being refused it.
    expect(quotaExceeded(8, 10)).toBe(false);
    expect(quotaExceeded(9, 10)).toBe(false);
    expect(quotaExceeded(10, 10)).toBe(true);
    expect(quotaExceeded(11, 10)).toBe(true);
  });

  it('refuses everything at a limit of zero', () => {
    expect(quotaExceeded(0, 0)).toBe(true);
  });

  it('reads the right limit for each kind', () => {
    const s = licenseStatus({ ...base, maxUsers: 5, maxClients: 50, maxCases: null }, ist('2026-01-01'));
    expect(quotaLimit(s, 'users')).toBe(5);
    expect(quotaLimit(s, 'clients')).toBe(50);
    expect(quotaLimit(s, 'cases')).toBeNull();
  });

  it('names the limit in the message, and gets the plural right', () => {
    expect(quotaMessage('clients', 10)).toContain('10 clients');
    expect(quotaMessage('users', 1)).toContain('1 team member');
    expect(quotaMessage('users', 1)).not.toContain('members');
  });
});

describe('plan defaults', () => {
  it('covers every plan', () => {
    for (const plan of LICENSE_PLANS) {
      expect(PLAN_DEFAULTS[plan], plan).toBeDefined();
    }
  });

  it('gives a trial a real end date and enterprise no limits', () => {
    expect(PLAN_DEFAULTS.TRIAL.termDays).toBe(30);
    expect(PLAN_DEFAULTS.ENTERPRISE.maxUsers).toBeNull();
    expect(PLAN_DEFAULTS.ENTERPRISE.maxClients).toBeNull();
    expect(PLAN_DEFAULTS.ENTERPRISE.maxCases).toBeNull();
  });

  it('never suggests a licence that has already run out', () => {
    const from = new Date('2026-09-20T00:00:00.000Z');
    for (const plan of LICENSE_PLANS) {
      const expiry = defaultExpiryFor(plan, from);
      if (expiry === null) continue;
      expect(expiry > '2026-09-20', `${plan} suggested ${expiry}`).toBe(true);
    }
  });

  it('dates a trial 30 days out', () => {
    expect(defaultExpiryFor('TRIAL', new Date('2026-09-20T00:00:00.000Z'))).toBe('2026-10-20');
  });
});
