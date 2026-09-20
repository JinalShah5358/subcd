/**
 * Licensing: what a firm has paid for, and what happens when it lapses.
 *
 * The state machine lives here, in shared code, because two things have to
 * agree about it and they run in different processes: the API decides whether
 * to accept a write, and the web app decides which banner to show. A firm told
 * "you have 4 days left" and then refused a save would be a worse bug than
 * having no banner at all.
 *
 * Everything in this file is pure. `now` is a parameter, never `Date.now()`
 * read implicitly, so every state is reachable from a test.
 */

export const LICENSE_PLANS = ['TRIAL', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'] as const;
export type LicensePlan = (typeof LICENSE_PLANS)[number];

export const LICENSE_PLAN_LABEL: Record<LicensePlan, string> = {
  TRIAL: 'Trial',
  STARTER: 'Starter',
  PROFESSIONAL: 'Professional',
  ENTERPRISE: 'Enterprise',
};

/**
 * What picking a plan fills in. These are suggestions the console pre-fills,
 * not constraints: every limit remains editable per firm, because the firm
 * that needs 260 clients on a Professional plan is a conversation, not an
 * upgrade the software should force.
 *
 * `null` means unlimited, everywhere in this file.
 */
export interface PlanDefaults {
  termDays: number | null;
  graceDays: number;
  maxUsers: number | null;
  maxClients: number | null;
  maxCases: number | null;
}

export const PLAN_DEFAULTS: Record<LicensePlan, PlanDefaults> = {
  TRIAL: { termDays: 30, graceDays: 7, maxUsers: 3, maxClients: 10, maxCases: 10 },
  STARTER: { termDays: 365, graceDays: 14, maxUsers: 5, maxClients: 50, maxCases: 100 },
  PROFESSIONAL: { termDays: 365, graceDays: 14, maxUsers: 25, maxClients: 250, maxCases: null },
  ENTERPRISE: { termDays: 365, graceDays: 30, maxUsers: null, maxClients: null, maxCases: null },
};

/* ------------------------------ the states ------------------------------ */

export const LICENSE_STATES = ['VALID', 'EXPIRING_SOON', 'GRACE', 'READ_ONLY'] as const;
export type LicenseState = (typeof LICENSE_STATES)[number];

export const LICENSE_STATE_LABEL: Record<LicenseState, string> = {
  VALID: 'Valid',
  EXPIRING_SOON: 'Expiring soon',
  GRACE: 'In grace period',
  READ_ONLY: 'Expired — read only',
};

/** Days before expiry at which the app starts saying so. */
export const EXPIRY_WARNING_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * India Standard Time is a fixed +05:30 with no daylight saving, so the offset
 * is a constant rather than a lookup. A subsidy deadline is a Gujarat date;
 * evaluating it in UTC would end a licence at 5:30 in the morning.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Which IST calendar day an instant falls on, as a day number. */
function istDayNumber(instantMs: number): number {
  return Math.floor((instantMs + IST_OFFSET_MS) / DAY_MS);
}

/**
 * The expiry column is a DATE. Prisma hands it back as midnight UTC of that
 * date, which is the same day number the helper above produces — so the two
 * are directly comparable without reconstructing a timestamp.
 */
function expiryDayNumber(expiresAt: Date): number {
  return Math.floor(expiresAt.getTime() / DAY_MS);
}

export interface LicenseFields {
  plan: LicensePlan;
  /** Null means a licence with no end date. */
  expiresAt: Date | string | null;
  graceDays: number;
  maxUsers: number | null;
  maxClients: number | null;
  maxCases: number | null;
}

export interface LicenseStatus {
  plan: LicensePlan;
  state: LicenseState;
  /** True once the grace period is also past. Writes are refused. */
  readOnly: boolean;
  expiresAt: string | null;
  /** 0 = expires today. Negative = already expired. Null = no expiry. */
  daysRemaining: number | null;
  /** How many days of grace are left once expired; null otherwise. */
  graceDaysRemaining: number | null;
  graceDays: number;
  maxUsers: number | null;
  maxClients: number | null;
  maxCases: number | null;
}

/**
 * Where a firm stands right now.
 *
 * The one decision worth defending: expiry makes a firm **read-only**, it does
 * not lock them out. These are a CA firm's professional records and they may
 * be obliged to produce them. Withholding a client's own case file over a late
 * renewal is not a thing this software should do. Suspension — a separate,
 * reasoned, audited act — is the lever that refuses sign-in.
 */
export function licenseStatus(fields: LicenseFields, now: Date): LicenseStatus {
  const expiresAt = fields.expiresAt == null ? null : new Date(fields.expiresAt);

  const base = {
    plan: fields.plan,
    graceDays: fields.graceDays,
    maxUsers: fields.maxUsers,
    maxClients: fields.maxClients,
    maxCases: fields.maxCases,
  };

  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    return {
      ...base,
      state: 'VALID',
      readOnly: false,
      expiresAt: null,
      daysRemaining: null,
      graceDaysRemaining: null,
    };
  }

  const iso = expiresAt.toISOString().slice(0, 10);
  const daysRemaining = expiryDayNumber(expiresAt) - istDayNumber(now.getTime());

  if (daysRemaining >= 0) {
    return {
      ...base,
      state: daysRemaining <= EXPIRY_WARNING_DAYS ? 'EXPIRING_SOON' : 'VALID',
      readOnly: false,
      expiresAt: iso,
      daysRemaining,
      graceDaysRemaining: null,
    };
  }

  // Expired. `graceDays` counts calendar days AFTER the expiry date, so a
  // grace of 7 covers D+1 through D+7 and read-only begins on D+8. The number
  // returned includes today, which is what a banner saying "3 days left" means.
  const daysPast = -daysRemaining;
  const graceDaysRemaining = Math.max(0, fields.graceDays - daysPast + 1);
  const inGrace = graceDaysRemaining > 0;

  return {
    ...base,
    state: inGrace ? 'GRACE' : 'READ_ONLY',
    readOnly: !inGrace,
    expiresAt: iso,
    daysRemaining,
    graceDaysRemaining,
  };
}

/* -------------------------------- quotas -------------------------------- */

export const QUOTA_KINDS = ['users', 'clients', 'cases'] as const;
export type QuotaKind = (typeof QUOTA_KINDS)[number];

export const QUOTA_NOUN: Record<QuotaKind, string> = {
  users: 'team member',
  clients: 'client',
  cases: 'case',
};

export function quotaLimit(status: LicenseStatus, kind: QuotaKind): number | null {
  if (kind === 'users') return status.maxUsers;
  if (kind === 'clients') return status.maxClients;
  return status.maxCases;
}

/**
 * Is there room for one more?
 *
 * `used` is the count as it stands. A limit of 10 with 10 used is full; the
 * off-by-one here is the difference between a firm getting the eleventh client
 * they paid for and being refused the tenth.
 */
export function quotaExceeded(used: number, limit: number | null): boolean {
  return limit !== null && used >= limit;
}

/** The sentence a user reads when they hit one. Names the limit, not a code. */
export function quotaMessage(kind: QuotaKind, limit: number): string {
  return `This firm's licence allows ${limit} ${QUOTA_NOUN[kind]}${limit === 1 ? '' : 's'}`;
}

/**
 * Suggested expiry when a plan is picked, as a DATE-only ISO string.
 * Null for a plan with no fixed term.
 */
export function defaultExpiryFor(plan: LicensePlan, from: Date): string | null {
  const { termDays } = PLAN_DEFAULTS[plan];
  if (termDays === null) return null;
  return new Date(from.getTime() + termDays * DAY_MS).toISOString().slice(0, 10);
}
