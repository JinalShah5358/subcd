import { z } from 'zod';
import {
  GSTIN_REGEX,
  IFSC_REGEX,
  PAN_REGEX,
  PHONE_IN_REGEX,
  PINCODE_REGEX,
  UDYAM_REGEX,
  gstinChecksumValid,
  normalizeGstin,
  normalizePan,
  normalizePhone,
  normalizeUdyam,
} from '../util/identifiers';

/** Every entity id in this system is a UUID v7 GUID, surfaced as `id`. */
export const uuid = z.string().uuid('Must be a valid GUID');

export const shortText = (max: number) => z.string().trim().max(max);
export const requiredText = (max: number, label = 'This field') =>
  z.string().trim().min(1, `${label} is required`).max(max);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : (v ?? null)));

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

export const optionalEmail = z
  .union([z.literal(''), email])
  .optional()
  .nullable()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const phone = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine((v) => PHONE_IN_REGEX.test(v), 'Enter a valid 10-digit Indian mobile number');

export const optionalPhone = z
  .union([z.literal(''), phone])
  .optional()
  .nullable()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const pan = z
  .string()
  .trim()
  .transform(normalizePan)
  .refine((v) => PAN_REGEX.test(v), 'PAN must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)');

export const optionalPan = z
  .union([z.literal(''), pan])
  .optional()
  .nullable()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const gstin = z
  .string()
  .trim()
  .transform(normalizeGstin)
  .refine((v) => GSTIN_REGEX.test(v), 'GSTIN must be 15 characters in the standard format')
  .refine((v) => gstinChecksumValid(v), 'GSTIN check digit is invalid — please re-check');

export const optionalGstin = z
  .union([z.literal(''), gstin])
  .optional()
  .nullable()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const udyam = z
  .string()
  .trim()
  .transform(normalizeUdyam)
  .refine((v) => UDYAM_REGEX.test(v), 'Udyam number looks like UDYAM-GJ-01-0000000');

export const optionalUdyam = z
  .union([z.literal(''), udyam])
  .optional()
  .nullable()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const ifsc = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => IFSC_REGEX.test(v), 'IFSC is 4 letters, a zero, then 6 characters');

export const optionalIfsc = z
  .union([z.literal(''), ifsc])
  .optional()
  .nullable()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const pincode = z
  .string()
  .trim()
  .refine((v) => PINCODE_REGEX.test(v), 'PIN code must be 6 digits');

export const optionalPincode = z
  .union([z.literal(''), pincode])
  .optional()
  .nullable()
  .transform((v) => (v === '' || v === undefined ? null : v));

/** Aadhaar: last 4 digits only. Full-number storage is blocked by design. */
export const optionalAadhaarLast4 = z
  .union([z.literal(''), z.string().trim().regex(/^[0-9]{4}$/, 'Enter the last 4 digits only')])
  .optional()
  .nullable()
  .transform((v) => (v === '' || v === undefined ? null : v));

/**
 * Money is a decimal STRING end to end. Never a JS number — see ADR-014.
 * Accepts a number for form convenience and normalises it to a string.
 */
const MONEY_REGEX = /^\d{1,14}(\.\d{1,2})?$/;

export const money = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toFixed(2) : v.trim().replace(/,/g, '')))
  .refine((v) => MONEY_REGEX.test(v), 'Enter an amount with at most 2 decimal places');

export const optionalMoney = z
  .union([z.literal(''), z.null(), z.undefined(), money])
  .optional()
  .nullable()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const percent = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
  .refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v), 'Enter a percentage')
  .refine((v) => Number(v) >= 0 && Number(v) <= 100, 'Must be between 0 and 100');

export const optionalPercent = z
  .union([z.literal(''), percent])
  .optional()
  .nullable()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const nonNegativeInt = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'string' ? (v.trim() === '' ? NaN : Number(v)) : v))
  .refine((v) => Number.isInteger(v) && v >= 0, 'Enter a whole number of 0 or more');

export const optionalCount = z
  .union([z.literal(''), z.null(), z.undefined(), nonNegativeInt])
  .optional()
  .nullable()
  .transform((v) => (v === '' || v === undefined || (typeof v === 'number' && Number.isNaN(v)) ? null : v));

/** Dates travel as 'YYYY-MM-DD' strings. No timezone ambiguity, no Date objects on the wire. */
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const dateString = z
  .string()
  .trim()
  .refine((v) => DATE_REGEX.test(v), 'Enter a date as DD/MM/YYYY')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'That date does not exist');

export const optionalDate = z
  .union([z.literal(''), dateString])
  .optional()
  .nullable()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const optionalPastOrTodayDate = optionalDate.refine(
  (v) => v === null || v <= new Date().toISOString().slice(0, 10),
  'Date cannot be in the future',
);

export const cursorPagination = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CursorPagination = z.infer<typeof cursorPagination>;

/**
 * Page-based pagination for the list endpoints.
 *
 * A keyset cursor scales better, but it can only move forward: it cannot
 * answer "how many are there" or "take me to page 7", which is what a CA
 * working through a list actually asks for. At firm scale — thousands of
 * clients, not millions — OFFSET with a COUNT is the honest trade.
 */
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PageQuery = z.infer<typeof pageQuery>;

export const sortDirection = z.enum(['asc', 'desc']).default('desc');
