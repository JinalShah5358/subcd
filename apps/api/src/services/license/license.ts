import type { NextFunction, Request, Response } from 'express';
import {
  licenseStatus,
  quotaExceeded,
  quotaLimit,
  quotaMessage,
  type LicensePlan,
  type LicenseStatus,
  type QuotaKind,
} from '@ifp/shared';
import { getAuth } from '../../auth/context';
import { basePrisma } from '../../db/prisma';
import { licenseExpired, licenseQuota, notFound } from '../../utils/problem';

/**
 * Enforcing a licence.
 *
 * The state machine itself is in `@ifp/shared` so the web app's banner and
 * this file's refusals cannot disagree. What lives here is the reading of it
 * and the two consequences: an expired licence makes a firm read-only, and a
 * full quota refuses one more of the thing that is full.
 *
 * Deliberately uncached. The obvious optimisation is a short TTL on the firm's
 * licence, and it is the wrong trade: it buys one indexed primary-key lookup
 * per *write* request — not per request — at the cost of a window in which a
 * renewal has been paid for and the firm is still being refused. Correct and
 * boring beats fast and occasionally wrong, on a path this cold.
 */

interface LicenseRow {
  status: string;
  plan: string;
  license_expires_at: Date | null;
  license_grace_days: number;
  max_users: number | null;
  max_clients: number | null;
  max_cases: number | null;
  user_count: bigint;
  client_count: bigint;
  case_count: bigint;
}

export interface FirmLicense {
  firmStatus: string;
  status: LicenseStatus;
  used: Record<QuotaKind, number>;
}

/**
 * Read through a SECURITY DEFINER function for the same reason the
 * authentication lookups do: this runs before any tenant transaction exists,
 * and with no tenant set every RLS policy fails closed. The function's return
 * type is its limit — one firm's licence and its three counts.
 */
export async function firmLicense(firmId: string, now = new Date()): Promise<FirmLicense> {
  const rows = await basePrisma.$queryRaw<LicenseRow[]>`
    SELECT * FROM firm_license_state(${firmId}::uuid)
  `;
  const row = rows[0];
  if (!row) throw notFound('That firm');

  return {
    firmStatus: row.status,
    status: licenseStatus(
      {
        plan: row.plan as LicensePlan,
        expiresAt: row.license_expires_at,
        graceDays: row.license_grace_days,
        maxUsers: row.max_users,
        maxClients: row.max_clients,
        maxCases: row.max_cases,
      },
      now,
    ),
    used: {
      users: Number(row.user_count),
      clients: Number(row.client_count),
      cases: Number(row.case_count),
    },
  };
}

/* ------------------------------ enforcement ------------------------------ */

/** Methods that cannot change anything and are never refused for a licence. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Paths that stay writable on a read-only licence.
 *
 * Two of them, and both are about getting out rather than getting more: a
 * signed-out session and an export. Locking a firm out of the exit is how a
 * billing dispute turns into a hostage situation.
 */
const ALWAYS_WRITABLE = [/\/auth\//, /\/export$/];

/**
 * Matched against the full path, not the router-relative one. A guard whose
 * meaning changes with where its router happens to be mounted is a guard that
 * will one day be mounted somewhere else.
 */
function exempt(req: Request): boolean {
  const path = req.originalUrl.split('?')[0] ?? '';
  return ALWAYS_WRITABLE.some((re) => re.test(path));
}

/**
 * Refuses writes once a licence has expired and its grace period has passed.
 *
 * Mounted on every tenant router immediately after `authenticate()`. It is a
 * router-level guard rather than a per-route one on purpose: the failure mode
 * worth designing against is a route added later and not thought about, and a
 * guard you have to remember to add is one you will eventually not add.
 * `license.coverage.test.ts` fails the build if a tenant router loses it.
 */
export function enforceLicense() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (SAFE_METHODS.has(req.method) || exempt(req)) return next();

      const { firmId } = getAuth();
      const license = await firmLicense(firmId);
      if (license.status.readOnly) throw licenseExpired(license.status.expiresAt);

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Is there room for one more?
 *
 * Called at the three creation points rather than in middleware, because the
 * count that matters is different at each one and the message has to name the
 * thing the user was actually trying to add.
 */
export async function assertQuota(firmId: string, kind: QuotaKind): Promise<void> {
  const license = await firmLicense(firmId);
  const limit = quotaLimit(license.status, kind);
  if (limit === null) return; // unlimited
  if (!quotaExceeded(license.used[kind], limit)) return;

  throw licenseQuota(
    quotaMessage(kind, limit),
    `${license.used[kind]} of ${limit} in use. A platform administrator can raise the limit.`,
  );
}

/** The shape the web app renders its banner from. */
export function licenseSummary(license: FirmLicense): Record<string, unknown> {
  const s = license.status;
  return {
    plan: s.plan,
    state: s.state,
    readOnly: s.readOnly,
    expiresAt: s.expiresAt,
    daysRemaining: s.daysRemaining,
    graceDaysRemaining: s.graceDaysRemaining,
    graceDays: s.graceDays,
    limits: { users: s.maxUsers, clients: s.maxClients, cases: s.maxCases },
    used: license.used,
  };
}
