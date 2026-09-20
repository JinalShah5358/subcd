import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { withTenant } from '../../db/tenant';
import { internal } from '../../utils/problem';

/**
 * Application-layer encryption — the layer that actually matters.
 *
 * Volume encryption protects against someone stealing a disk. It does nothing
 * against a database dump taken through the application's own credentials.
 * These functions mean PAN / GSTIN / loan account numbers are ciphertext in any
 * dump, with keys held outside the database.
 *
 * Envelope scheme:
 *   master key (KMS)  ->  wraps  ->  per-firm DEK  ->  encrypts  ->  field
 *
 * Every ciphertext is bound by AAD to firmId:table:column:rowId, so a
 * ciphertext copied into another row — or another tenant — fails to decrypt
 * rather than silently decoding to someone else's PAN.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_VERSION = 1;

// ------------------------------- KMS (local stub) -------------------------------

/**
 * Local development KMS. In production this is replaced by a call to a real KMS
 * (wrap/unwrap only — the master key never enters the process).
 */
function masterKey(): Buffer {
  const key = Buffer.from(env.KMS_LOCAL_MASTER_KEY, 'base64');
  if (key.length !== 32) throw internal('Master key is not 32 bytes');
  return key;
}

function wrapDek(dek: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
  return Buffer.concat([Buffer.from([KEY_VERSION]), iv, cipher.getAuthTag(), ct]);
}

function unwrapDek(wrapped: Buffer): Buffer {
  const version = wrapped[0];
  if (version !== KEY_VERSION) throw internal('Unsupported key version');
  const iv = wrapped.subarray(1, 1 + IV_LEN);
  const tag = wrapped.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ct = wrapped.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

// ------------------------------- DEK cache -------------------------------

interface CachedKey {
  dek: Buffer;
  expiresAt: number;
}
const dekCache = new Map<string, CachedKey>();
const DEK_CACHE_TTL_MS = 15 * 60 * 1000;

export function clearDekCache(): void {
  dekCache.clear();
}

/**
 * Returns the firm's data encryption key, provisioning one on first use.
 * Reads the firm row through the BASE client deliberately: key material is
 * infrastructure, and the caller has already been tenant-checked.
 */
export async function getFirmDek(firmId: string): Promise<Buffer> {
  const cached = dekCache.get(firmId);
  if (cached && cached.expiresAt > Date.now()) return cached.dek;

  const dek = await withTenant(firmId, async (tx) => {
    const firm = await tx.firm.findFirst({
      where: { id: firmId },
      select: { id: true, wrappedDek: true },
    });
    if (!firm) throw internal('Unknown firm while resolving encryption key');

    if (firm.wrappedDek) return unwrapDek(Buffer.from(firm.wrappedDek));

    // First use for this firm: provision a data encryption key.
    const fresh = randomBytes(32);
    await tx.firm.update({
      where: { id: firmId },
      data: { wrappedDek: wrapDek(fresh), dekVersion: KEY_VERSION },
    });
    return fresh;
  });

  dekCache.set(firmId, { dek, expiresAt: Date.now() + DEK_CACHE_TTL_MS });
  return dek;
}

// ------------------------------- field crypto -------------------------------

export interface FieldContext {
  firmId: string;
  table: string;
  column: string;
  rowId: string;
}

function aad(ctx: FieldContext): Buffer {
  return Buffer.from(`${ctx.firmId}:${ctx.table}:${ctx.column}:${ctx.rowId}`, 'utf8');
}

export async function encryptField(plaintext: string, ctx: FieldContext): Promise<Buffer> {
  const dek = await getFirmDek(ctx.firmId);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, dek, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(aad(ctx));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([KEY_VERSION]), iv, cipher.getAuthTag(), ct]);
}

export async function decryptField(
  ciphertext: Uint8Array | Buffer | null | undefined,
  ctx: FieldContext,
): Promise<string | null> {
  if (!ciphertext) return null;
  const buf = Buffer.from(ciphertext);
  const version = buf[0];
  if (version !== KEY_VERSION) throw internal('Unsupported ciphertext version');

  const dek = await getFirmDek(ctx.firmId);
  const iv = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ct = buf.subarray(1 + IV_LEN + TAG_LEN);

  const decipher = createDecipheriv(ALGO, dek, iv, { authTagLength: TAG_LEN });
  decipher.setAAD(aad(ctx));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // Wrong AAD (moved row / wrong tenant) or tampered ciphertext.
    throw internal('Stored value could not be decrypted');
  }
}

// ------------------------------- blind index -------------------------------

/**
 * Deterministic HMAC so we can answer "is this PAN already on file?" without
 * decrypting anything. The pepper lives in the secrets manager, NEVER in the
 * database — a database dump alone cannot be brute-forced back to a PAN
 * without it.
 *
 * Scoped per firm so the same PAN in two firms produces different indexes.
 */
export function blindIndex(value: string, firmId: string, field: string): Buffer {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, '');
  return createHmac('sha256', env.BLIND_INDEX_PEPPER)
    .update(`${firmId}:${field}:${normalized}`, 'utf8')
    .digest();
}

export function blindIndexEquals(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ------------------------------- helpers -------------------------------

export function last4(value: string): string {
  return value.trim().slice(-4);
}

export function maskedFromLast4(value: string | null, width = 10): string | null {
  if (!value) return null;
  return `${'•'.repeat(Math.max(0, width - value.length))}${value}`;
}

/**
 * Encrypt + derive the three stored columns in one step, so a call site cannot
 * accidentally store the ciphertext without the blind index.
 */
export async function sealIdentifier(
  plaintext: string | null,
  ctx: FieldContext & { field: string },
): Promise<{ enc: Buffer | null; last4: string | null; blindIndex: Buffer | null }> {
  if (!plaintext) return { enc: null, last4: null, blindIndex: null };
  return {
    enc: await encryptField(plaintext, ctx),
    last4: last4(plaintext),
    blindIndex: blindIndex(plaintext, ctx.firmId, ctx.field),
  };
}
