/**
 * UUID v7 — time-ordered GUIDs.
 *
 * Every entity id in this system is one of these, exposed as `id`.
 * Time-ordered means index locality close to a bigserial while staying
 * non-enumerable in URLs (you cannot guess the next case's id).
 *
 * Layout (RFC 9562):
 *   48 bits  unix_ts_ms
 *    4 bits  version (0111)
 *   12 bits  rand_a
 *    2 bits  variant (10)
 *   62 bits  rand_b
 *
 * Uses globalThis.crypto so the same code runs in Node 20 and the browser.
 */
export function uuidv7(timestampMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  const ts = BigInt(timestampMs);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  // version 7
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  // RFC 4122 variant
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push((bytes[i] as number).toString(16).padStart(2, '0'));

  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

/** Extracts the embedded timestamp. Useful in tests and for debugging ordering. */
export function uuidv7Timestamp(id: string): Date {
  const hex = id.replace(/-/g, '').slice(0, 12);
  return new Date(Number.parseInt(hex, 16));
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/** Opaque cursor for keyset pagination: base64url of the last id seen.
 *  Uses btoa/atob so the same helper works in Node and the browser. */
export function encodeCursor(id: string): string {
  return globalThis
    .btoa(id)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeCursor(cursor: string): string | null {
  try {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = globalThis.atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return isUuid(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
