import { z } from 'zod';
import {
  AUDIT_ACTION,
  CONSENT_METHOD,
  FIRM_STATUS,
  DOCUMENT_SLOT_STATUS,
  RULE_SEVERITY,
  VALIDATION_TRIGGER,
  VERIFICATION_STATUS,
  type FirmStatus,
} from '../constants/enums';
import { optionalDate, optionalText, requiredText, uuid } from './common';
import { ASSIGNABLE_ROLE_KEYS } from '../constants/permissions';
import { LICENSE_PLANS } from '../util/license';

/* ----------------------------- documents ----------------------------- */

export const documentSlotUpdateSchema = z
  .object({
    status: z.enum(DOCUMENT_SLOT_STATUS),
    verificationStatus: z.enum(VERIFICATION_STATUS).optional(),
    notes: optionalText(1000),
  })
  .strict();
export type DocumentSlotUpdateInput = z.infer<typeof documentSlotUpdateSchema>;

/* ------------------------------ consent ------------------------------ */

export const consentRecordSchema = z
  .object({
    clientId: uuid,
    caseId: uuid.optional().nullable(),
    templateId: uuid,
    method: z.enum(CONSENT_METHOD).default('CA_ATTESTATION'),
    /**
     * The exact sentence the user affirmed, snapshotted with the record.
     * The client sends it back so we can prove what was on screen.
     */
    attestationText: requiredText(2000, 'Attestation text'),
    affirmed: z.literal(true, {
      errorMap: () => ({ message: 'You must confirm the authorization to continue' }),
    }),
    validUntil: optionalDate,
    clientContactName: optionalText(160),
    notes: optionalText(1000),
  })
  .strict();
export type ConsentRecordInput = z.infer<typeof consentRecordSchema>;

export const consentWithdrawSchema = z
  .object({
    reason: requiredText(500, 'Reason'),
  })
  .strict();
export type ConsentWithdrawInput = z.infer<typeof consentWithdrawSchema>;

/* ---------------------------- validation ----------------------------- */

export const validationRunSchema = z
  .object({
    trigger: z.enum(VALIDATION_TRIGGER).default('MANUAL'),
  })
  .strict();
export type ValidationRunInput = z.infer<typeof validationRunSchema>;

export const findingWaiveSchema = z
  .object({
    reason: requiredText(500, 'Waiver reason'),
  })
  .strict();
export type FindingWaiveInput = z.infer<typeof findingWaiveSchema>;

export const findingSchema = z.object({
  id: uuid,
  ruleCode: z.string(),
  ruleName: z.string(),
  severity: z.enum(RULE_SEVERITY),
  category: z.string(),
  message: z.string(),
  remediationHint: z.string().nullable(),
  fieldCode: z.string().nullable(),
  section: z.string().nullable(),
  status: z.string(),
  waiverReason: z.string().nullable(),
  sourceReference: z.string().nullable(),
});
export type ValidationFinding = z.infer<typeof findingSchema>;

export const validationRunResultSchema = z.object({
  id: uuid,
  caseId: uuid,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  trigger: z.string(),
  blockingCount: z.number(),
  warningCount: z.number(),
  infoCount: z.number(),
  readinessScore: z.number(),
  rulesetHash: z.string(),
  findings: z.array(findingSchema),
});
export type ValidationRunResult = z.infer<typeof validationRunResultSchema>;

/* ------------------------------- audit ------------------------------- */

export const auditSearchSchema = z
  .object({
    action: z.enum(AUDIT_ACTION).optional(),
    actorUserId: uuid.optional(),
    entityType: z.string().trim().max(48).optional(),
    entityId: uuid.optional(),
    from: optionalDate,
    to: optionalDate,
    // The audit trail is only ever read newest-first or oldest-first; there is
    // no other meaningful ordering for an append-only log.
    sort: z.enum(['occurredAt']).default('occurredAt'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type AuditSearchInput = z.infer<typeof auditSearchSchema>;

/* ----------------------------- users/firm ---------------------------- */

export const userSearchSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    roleKey: z.string().trim().max(32).optional(),
    status: z.enum(['ACTIVE', 'INVITED', 'DISABLED']).optional(),
    sort: z.enum(['fullName', 'email', 'lastLoginAt', 'createdAt']).default('fullName'),
    dir: z.enum(['asc', 'desc']).default('asc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type UserSearchInput = z.infer<typeof userSearchSchema>;

export const inviteUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
    fullName: requiredText(160, 'Full name'),
    roleKey: z.enum(ASSIGNABLE_ROLE_KEYS as [string, ...string[]]),
  })
  .strict();
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: optionalText(160),
    phone: optionalText(20),
    roleKey: z.enum(ASSIGNABLE_ROLE_KEYS as [string, ...string[]]).optional(),
  })
  .strict();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const updateFirmSchema = z
  .object({
    name: optionalText(200),
    frn: optionalText(32),
    contactEmail: optionalText(254),
    contactPhone: optionalText(20),
    addressLine1: optionalText(200),
    addressLine2: optionalText(200),
    city: optionalText(100),
    state: optionalText(100),
    pincode: optionalText(6),
  })
  .strict();
export type UpdateFirmInput = z.infer<typeof updateFirmSchema>;

/* -------------------------------- licensing ------------------------------- */

/**
 * A quota. Null is unlimited and is a real answer, not "unset" — which is why
 * the field is nullable rather than optional: a console that omits `maxCases`
 * because the box was cleared and one that omits it because it never rendered
 * would otherwise be indistinguishable.
 */
const quota = z
  .union([z.literal(''), z.coerce.number().int().min(0).max(1_000_000)])
  .nullable()
  .transform((v) => (v === '' || v === undefined ? null : (v as number | null)));

export const licenseUpdateSchema = z
  .object({
    plan: z.enum(LICENSE_PLANS),
    /** Date-only. The licence is valid through the end of this day, IST. */
    expiresAt: optionalDate,
    graceDays: z.coerce.number().int().min(0).max(180).default(14),
    maxUsers: quota,
    maxClients: quota,
    maxCases: quota,
    note: optionalText(500),
    /**
     * Changing what a firm is allowed to do is a commercial act with an
     * operational consequence, so it goes in the audit trail with a stated
     * reason rather than just a diff. "Renewed, invoice INV-2027-114" is worth
     * more six months later than knowing the date moved.
     */
    reason: requiredText(500, 'Reason'),
  })
  .strict();
export type LicenseUpdateInput = z.infer<typeof licenseUpdateSchema>;

/** The licence block accepted when a firm is provisioned. All of it optional. */
export const licenseCreateSchema = z
  .object({
    plan: z.enum(LICENSE_PLANS).default('TRIAL'),
    expiresAt: optionalDate,
    graceDays: z.coerce.number().int().min(0).max(180).optional(),
    maxUsers: quota.optional(),
    maxClients: quota.optional(),
    maxCases: quota.optional(),
    note: optionalText(500),
  })
  .strict();
export type LicenseCreateInput = z.infer<typeof licenseCreateSchema>;

export const platformLicenseSearchSchema = z
  .object({
    /** Only firms whose licence ends within this many days (or already has). */
    withinDays: z.coerce.number().int().min(0).max(365).default(30),
    /**
     * Declared, but fixed. This list has one useful order — expired first,
     * then soonest — and pretending to accept another would mean accepting a
     * parameter the query ignores.
     */
    sort: z.literal('expiresAt').default('expiresAt'),
    dir: z.literal('asc').default('asc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type PlatformLicenseSearchInput = z.infer<typeof platformLicenseSearchSchema>;


/* ---------------------------- platform admin ---------------------------- */

/**
 * Provisioning a tenant.
 *
 * A firm and its first administrator are created together on purpose: a firm
 * with no way in is not a provisioned firm, it is an orphan row that someone
 * has to notice and clean up.
 */
export const firmCreateSchema = z
  .object({
    name: requiredText(200, 'Firm name'),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'The slug needs at least 3 characters')
      .max(64)
      .regex(
        /^[a-z0-9]+(-[a-z0-9]+)*$/,
        'Lowercase letters, numbers and single hyphens only',
      ),
    frn: optionalText(32),
    contactEmail: z
      .union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email').max(254)])
      .optional()
      .transform((v) => (v ? v : null)),
    city: optionalText(100),
    state: optionalText(100),
    dataRegion: z.string().trim().max(16).default('in-west'),

    /** The first administrator. They receive an invitation, not a password. */
    adminEmail: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
    adminFullName: requiredText(160, 'Administrator name'),

    /**
     * The licence. Omitted entirely, a new firm gets a 30-day trial — which is
     * the right default for the case where somebody is evaluating the product,
     * and a safe one for the case where somebody forgot to set it.
     */
    license: licenseCreateSchema.optional(),
  })
  .strict();
export type FirmCreateInput = z.infer<typeof firmCreateSchema>;

export const FIRM_STATUS_LABEL: Record<FirmStatus, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed',
};

/**
 * Changing a firm's status needs a stated reason.
 *
 * Suspension locks a whole firm out of its own case files. That is a decision
 * someone should have to justify in writing, and the audit trail should carry
 * the justification rather than just the fact.
 */
export const firmStatusChangeSchema = z
  .object({
    status: z.enum(FIRM_STATUS),
    reason: requiredText(500, 'Reason'),
  })
  .strict();
export type FirmStatusChangeInput = z.infer<typeof firmStatusChangeSchema>;

export const platformFirmSearchSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.enum(FIRM_STATUS).optional(),
    sort: z.enum(['createdAt']).default('createdAt'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type PlatformFirmSearchInput = z.infer<typeof platformFirmSearchSchema>;
