import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { uuidv7 } from '@ifp/shared';
import { env, isProd } from '../config/env';
import { withTenant } from '../db/tenant';
import { findRefreshToken } from './lookups';
import { unauthorized } from '../utils/problem';
import { logger } from '../utils/logger';

export const REFRESH_COOKIE = isProd ? '__Host-ifp_rt' : 'ifp_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface AccessTokenClaims {
  sub: string;
  firmId: string;
  roleKey: string;
  perms: string[];
  clientType: 'WEB' | 'EXTENSION';
  jti: string;
}

export function signAccessToken(claims: Omit<AccessTokenClaims, 'jti'>): {
  token: string;
  expiresInSeconds: number;
} {
  const expiresInSeconds = env.ACCESS_TOKEN_TTL_MIN * 60;
  const token = jwt.sign({ ...claims, jti: uuidv7() }, env.JWT_SECRET, {
    algorithm: env.JWT_ALG,
    expiresIn: expiresInSeconds,
    issuer: 'ifp-api',
    audience: 'ifp-web',
  });
  return { token, expiresInSeconds };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      algorithms: [env.JWT_ALG],
      issuer: 'ifp-api',
      audience: 'ifp-web',
    }) as AccessTokenClaims;
  } catch {
    throw unauthorized('Your session has expired — please sign in again');
  }
}

// ----------------------------- refresh tokens -----------------------------

export const hashToken = (raw: string): string =>
  createHash('sha256').update(raw, 'utf8').digest('hex');

export const newOpaqueToken = (): string => randomBytes(32).toString('base64url');

interface IssueRefreshArgs {
  userId: string;
  firmId: string;
  familyId?: string;
  clientType?: 'WEB' | 'EXTENSION';
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/** Writes go through withTenant so the RLS policy is satisfied, never bypassed. */
export async function issueRefreshToken(args: IssueRefreshArgs): Promise<string> {
  const raw = newOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await withTenant(args.firmId, (tx) =>
    tx.refreshToken.create({
      data: {
        id: uuidv7(),
        firmId: args.firmId,
        userId: args.userId,
        familyId: args.familyId ?? uuidv7(),
        tokenHash: hashToken(raw),
        clientType: args.clientType ?? 'WEB',
        userAgentHash: args.userAgent
          ? createHash('sha256').update(args.userAgent).digest('hex')
          : null,
        ipAtIssue: args.ip ?? null,
        expiresAt,
      },
    }),
  );

  return raw;
}

export interface RotationResult {
  userId: string;
  firmId: string;
  rawToken: string;
}

/**
 * Rotates a refresh token.
 *
 * Presenting a token that was already spent means either a replay or a stolen
 * copy. We cannot tell which, so we revoke the entire family: the legitimate
 * user is signed out and the thief's copy dies with it.
 */
export async function rotateRefreshToken(
  raw: string,
  meta: { ip?: string | undefined; userAgent?: string | undefined },
): Promise<RotationResult> {
  const tokenHash = hashToken(raw);
  const existing = await findRefreshToken(tokenHash);

  if (!existing) throw unauthorized('Please sign in again');

  const reuseDetected = async (): Promise<never> => {
    await revokeFamily(existing.firm_id, existing.family_id, 'REUSE_DETECTED');
    logger.warn(
      { userId: existing.user_id, familyId: existing.family_id },
      'refresh token reuse detected — family revoked',
    );
    const err = unauthorized('Your session was ended for security reasons. Please sign in again.');
    (err as unknown as { reuseDetected: boolean }).reuseDetected = true;
    (err as unknown as { firmId: string }).firmId = existing.firm_id;
    (err as unknown as { userId: string }).userId = existing.user_id;
    throw err;
  };

  if (existing.used_at || existing.revoked_at) await reuseDetected();

  if (new Date(existing.expires_at).getTime() < Date.now()) {
    throw unauthorized('Your session has expired — please sign in again');
  }

  if (existing.user_status !== 'ACTIVE' || existing.user_deleted) {
    await revokeFamily(existing.firm_id, existing.family_id, 'USER_INACTIVE');
    throw unauthorized('This account is no longer active');
  }

  /**
   * Claim the token ATOMICALLY.
   *
   * The check above is necessary but not sufficient: two requests presenting
   * the same token concurrently would both read used_at = null and both go on
   * to mint a new token, which is exactly the case reuse detection exists to
   * catch — a thief replaying a stolen token while the real user is active.
   *
   * The conditional update makes the database the arbiter: exactly one caller
   * can move used_at from null, and anyone who updates zero rows has lost the
   * race and is treated as reuse.
   */
  const claimed = await withTenant(existing.firm_id, (tx) =>
    tx.refreshToken.updateMany({
      where: { id: existing.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    }),
  );

  if (claimed.count !== 1) await reuseDetected();

  const rawToken = await issueRefreshToken({
    userId: existing.user_id,
    firmId: existing.firm_id,
    familyId: existing.family_id,
    clientType: existing.client_type === 'EXTENSION' ? 'EXTENSION' : 'WEB',
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { userId: existing.user_id, firmId: existing.firm_id, rawToken };
}

export async function revokeFamily(
  firmId: string,
  familyId: string,
  reason: string,
): Promise<void> {
  await withTenant(firmId, (tx) =>
    tx.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    }),
  );
}

export async function revokeAllUserTokens(
  firmId: string,
  userId: string,
  reason: string,
): Promise<void> {
  await withTenant(firmId, (tx) =>
    tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    }),
  );
}

export async function revokeTokenByValue(raw: string, reason: string): Promise<void> {
  const existing = await findRefreshToken(hashToken(raw));
  if (!existing) return;
  await withTenant(existing.firm_id, (tx) =>
    tx.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    }),
  );
}

// ------------------------------- cookie -------------------------------

export function setRefreshCookie(res: Response, raw: string): void {
  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
  });
}
