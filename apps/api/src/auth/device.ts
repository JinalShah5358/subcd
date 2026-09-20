import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { uuidv7 } from '@ifp/shared';

import { getContext } from './context';
import { findUserById } from './lookups';
import { basePrisma } from '../db/prisma';
import { withTenant } from '../db/tenant';
import { forbidden, unauthorized } from '../utils/problem';

/**
 * How the browser extension authenticates.
 *
 * NOT with the CA's password, and not with their IFP credentials — the
 * extension never sees either. Pairing is a short-lived code, generated in the
 * web app by someone already signed in, exchanged once for a device secret.
 *
 * What the extension stores is therefore: a device id, and a secret that is
 * scoped to one firm, tied to one user, expires, and can be revoked from the
 * web app at any time. That is the smallest durable credential that lets the
 * extension work without asking for a password every time, and losing it
 * costs the CA a revoke-and-repair rather than an account.
 *
 * Only a hash of the secret is stored, the same way refresh and invitation
 * tokens are handled.
 */

/** Pairing codes are read aloud and typed, so no 0/O/1/I/5/S. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
export const PAIRING_CODE_TTL_MINUTES = 10;
export const DEVICE_TTL_DAYS = 90;

export function newPairingCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  // Grouped for reading: ABCD-EFGH
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export const normalizePairingCode = (raw: string): string =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const hashSecret = (raw: string): string =>
  createHash('sha256').update(raw, 'utf8').digest('hex');

export const newDeviceSecret = (): string => randomBytes(32).toString('base64url');

/**
 * Pairing codes live in memory, deliberately.
 *
 * They are valid for ten minutes and are consumed once. Persisting them would
 * add a table, a cleanup job and a row that briefly grants access, for no gain
 * — if the API restarts mid-pairing the CA generates another code, which is
 * three seconds of inconvenience rather than a support incident.
 *
 * Note for a multi-instance deployment: this would need to move to shared
 * storage, because a code minted on one instance is unknown to the next.
 */
interface PendingPairing {
  codeHash: string;
  firmId: string;
  userId: string;
  expiresAt: number;
}

const pending = new Map<string, PendingPairing>();

export function issuePairingCode(firmId: string, userId: string): { code: string; expiresAt: Date } {
  // One outstanding code per user: generating a new one invalidates the old.
  for (const [key, value] of pending) {
    if (value.userId === userId) pending.delete(key);
  }

  const code = newPairingCode();
  const codeHash = hashSecret(normalizePairingCode(code));
  const expiresAt = Date.now() + PAIRING_CODE_TTL_MINUTES * 60_000;

  pending.set(codeHash, { codeHash, firmId, userId, expiresAt });
  return { code, expiresAt: new Date(expiresAt) };
}

/** Consumes a code. Returns null for unknown, expired or already-used codes. */
export function redeemPairingCode(raw: string): { firmId: string; userId: string } | null {
  const codeHash = hashSecret(normalizePairingCode(raw));
  const entry = pending.get(codeHash);

  // Sweep expired entries whenever a redemption is attempted; the map is tiny
  // and this saves a timer.
  const now = Date.now();
  for (const [key, value] of pending) {
    if (value.expiresAt < now) pending.delete(key);
  }

  if (!entry || entry.expiresAt < now) return null;
  pending.delete(codeHash);
  return { firmId: entry.firmId, userId: entry.userId };
}

/** Test seam: pairing state is process-local and must not leak between tests. */
export function _resetPairingCodes(): void {
  pending.clear();
}

/* --------------------------- device requests --------------------------- */

export interface DeviceRow {
  id: string;
  firm_id: string;
  user_id: string;
  label: string;
  secret_hash: string;
  revoked_at: Date | null;
  expires_at: Date;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Authenticates a request from the extension.
 *
 * `Authorization: Device <deviceId>.<secret>`
 *
 * The device is looked up without a tenant (it is the thing that tells us
 * which tenant we are in), then the user is re-read exactly as
 * `authenticate()` does — so revoking a user, changing their role or
 * suspending their firm takes effect on the extension's next request too,
 * not when some cached token expires.
 */
export function authenticateDevice() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.header('authorization');
      if (!header?.startsWith('Device ')) throw unauthorized('Pair this browser first');

      const raw = header.slice('Device '.length).trim();
      const dot = raw.indexOf('.');
      if (dot <= 0) throw unauthorized('Pair this browser first');

      const deviceId = raw.slice(0, dot);
      const secret = raw.slice(dot + 1);
      if (!deviceId || !secret) throw unauthorized('Pair this browser first');

      // Which firm this device belongs to is exactly what we are trying to
      // establish, so no tenant is set yet and the RLS policy on
      // extension_device would — correctly — return nothing. This is the same
      // shape as login, and takes the same narrow SECURITY DEFINER route.
      const rows = await basePrisma.$queryRaw<DeviceRow[]>`
        SELECT * FROM auth_find_device(${deviceId}::uuid)
      `;
      const device = rows[0];

      // Same rejection for "no such device" and "wrong secret".
      if (!device || !constantTimeEqualHex(device.secret_hash, hashSecret(secret))) {
        throw unauthorized('This browser is no longer paired');
      }
      if (device.revoked_at) throw unauthorized('This browser was unpaired');
      if (device.expires_at.getTime() < Date.now()) {
        throw unauthorized('This pairing has expired — pair the browser again');
      }

      const user = await findUserById(device.user_id);
      if (!user || user.deleted_at || user.status !== 'ACTIVE') {
        throw unauthorized('This account is no longer active');
      }
      if (user.firm_status !== 'ACTIVE') throw forbidden('This firm account is suspended');
      if (user.firm_id !== device.firm_id) throw unauthorized('This browser is no longer paired');

      const store = getContext();
      store.clientType = 'EXTENSION';
      store.auth = {
        userId: user.id,
        firmId: user.firm_id,
        email: user.email,
        roleKey: user.role_key,
        permissions: user.role_permissions,
      };
      store.db = undefined;
      (store as { deviceId?: string }).deviceId = device.id;

      // Best-effort liveness, so an unused pairing is visible in the web app.
      void withTenant(device.firm_id, (tx) =>
        tx.extensionDevice.updateMany({
          where: { id: device.id },
          data: { lastSeenAt: new Date(), lastSeenIp: store.ip ?? null },
        }),
      ).catch(() => undefined);

      next();
    } catch (err) {
      next(err);
    }
  };
}

export function currentDeviceId(): string | undefined {
  return (getContext() as { deviceId?: string }).deviceId;
}

/** Creates a device record and returns the secret, which is shown exactly once. */
export async function registerDevice(args: {
  firmId: string;
  userId: string;
  label: string;
  agentVersion?: string | undefined;
  ip?: string | undefined;
}): Promise<{ deviceId: string; deviceSecret: string; expiresAt: Date }> {
  const deviceId = uuidv7();
  const deviceSecret = newDeviceSecret();
  const expiresAt = new Date(Date.now() + DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000);

  await withTenant(args.firmId, (tx) =>
    tx.extensionDevice.create({
      data: {
        id: deviceId,
        firmId: args.firmId,
        userId: args.userId,
        label: args.label,
        secretHash: hashSecret(deviceSecret),
        agentVersion: args.agentVersion ?? null,
        lastSeenAt: new Date(),
        lastSeenIp: args.ip ?? null,
        expiresAt,
      },
    }),
  );

  return { deviceId, deviceSecret, expiresAt };
}
