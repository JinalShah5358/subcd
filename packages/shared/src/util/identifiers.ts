/**
 * Format helpers for Indian business identifiers.
 * Pure functions, no I/O — used by Zod schemas, validation rules and the UI.
 */

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
export const PHONE_IN_REGEX = /^[6-9][0-9]{9}$/;
export const AADHAAR_LAST4_REGEX = /^[0-9]{4}$/;

export function normalizePan(v: string): string {
  return v.trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeGstin(v: string): string {
  return v.trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeUdyam(v: string): string {
  return v.trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizePhone(v: string): string {
  const digits = v.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export function isValidPan(v: string): boolean {
  return PAN_REGEX.test(normalizePan(v));
}

/**
 * GSTIN check digit, per the standard mod-36 weighted algorithm.
 * Returns false for anything that is not 15 well-formed characters.
 */
const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function gstinChecksumValid(value: string): boolean {
  const v = normalizeGstin(value);
  if (v.length !== 15) return false;

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const char = v[i];
    if (char === undefined) return false;
    const code = GSTIN_ALPHABET.indexOf(char);
    if (code < 0) return false;
    const factor = i % 2 === 0 ? 1 : 2;
    const product = code * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expectedIndex = (36 - (sum % 36)) % 36;
  return GSTIN_ALPHABET[expectedIndex] === v[14];
}

export function isValidGstin(v: string): boolean {
  return GSTIN_REGEX.test(normalizeGstin(v)) && gstinChecksumValid(v);
}

/** GSTIN characters 3..12 (1-indexed) are the holder's PAN. */
export function panFromGstin(gstin: string): string | null {
  const v = normalizeGstin(gstin);
  if (v.length !== 15) return null;
  return v.slice(2, 12);
}

/** Verhoeff checksum — the algorithm Aadhaar uses. We only ever use this to
 *  reject an obviously mistyped number at entry time; we do not store the value. */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function aadhaarChecksumValid(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 12 || digits.startsWith('0') || digits.startsWith('1')) return false;
  let c = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    const ch = reversed[i];
    if (ch === undefined) return false;
    const row = VERHOEFF_D[c];
    const pRow = VERHOEFF_P[i % 8];
    if (!row || !pRow) return false;
    const p = pRow[Number(ch)];
    if (p === undefined) return false;
    const next = row[p];
    if (next === undefined) return false;
    c = next;
  }
  return c === 0;
}

/** Mask for display: show only the last 4 characters. */
export function maskIdentifier(last4: string | null | undefined, totalLength = 10): string {
  if (!last4) return '—';
  const dots = '•'.repeat(Math.max(0, totalLength - last4.length));
  return `${dots}${last4}`;
}

export function last4(value: string): string {
  return value.slice(-4);
}
