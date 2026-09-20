import { z } from 'zod';
import { ENTITY_TYPE, PROMOTER_ROLE } from '../constants/enums';
import {
  optionalAadhaarLast4,
  optionalDate,
  optionalEmail,
  optionalGstin,
  optionalPan,
  optionalPercent,
  optionalPhone,
  optionalPincode,
  optionalText,
  optionalUdyam,
  requiredText,
  uuid,
} from './common';

export const addressFields = {
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  district: optionalText(100),
  taluka: optionalText(100),
  state: optionalText(100),
  pincode: optionalPincode,
};

export const clientCreateSchema = z
  .object({
    legalName: requiredText(250, 'Legal name'),
    tradeName: optionalText(250),
    entityType: z.enum(ENTITY_TYPE),
    constitutionNote: optionalText(250),
    businessActivity: optionalText(250),
    nicCode: optionalText(12),
    pan: optionalPan,
    gstin: optionalGstin,
    udyam: optionalUdyam,
    incorporationDate: optionalDate,

    regdAddressLine1: optionalText(200),
    regdAddressLine2: optionalText(200),
    regdCity: optionalText(100),
    regdDistrictCode: optionalText(12),
    regdPincode: optionalPincode,

    contactPersonName: optionalText(160),
    contactEmail: optionalEmail,
    contactPhone: optionalPhone,

    notes: optionalText(2000),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.entityType === 'OTHER' && !data.constitutionNote) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['constitutionNote'],
        message: 'Describe the constitution when entity type is Other',
      });
    }
  });
export type ClientCreateInput = z.infer<typeof clientCreateSchema>;

/** Partial update. Every field optional; `.strict()` still rejects unknown keys. */
export const clientUpdateSchema = clientCreateSchema.innerType().partial().strict();
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;

export const clientSearchSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    entityType: z.enum(ENTITY_TYPE).optional(),
    includeDeleted: z.coerce.boolean().optional().default(false),
    sort: z.enum(['legalName', 'createdAt', 'caseCount']).default('createdAt'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type ClientSearchInput = z.infer<typeof clientSearchSchema>;

/**
 * Duplicate probe. Returns only whether a match exists plus the existing id —
 * never the stored identifier value itself.
 */
export const duplicateCheckSchema = z
  .object({
    pan: optionalPan,
    gstin: optionalGstin,
    excludeClientId: uuid.optional(),
  })
  .strict()
  .refine((d) => Boolean(d.pan || d.gstin), {
    message: 'Provide a PAN or a GSTIN to check',
  });
export type DuplicateCheckInput = z.infer<typeof duplicateCheckSchema>;

export const revealFieldSchema = z
  .object({
    field: z.enum(['pan', 'gstin', 'udyam']),
  })
  .strict();
export type RevealFieldInput = z.infer<typeof revealFieldSchema>;

export const promoterRevealFieldSchema = z
  .object({
    field: z.enum(['pan']),
  })
  .strict();

export const promoterCreateSchema = z
  .object({
    fullName: requiredText(160, 'Full name'),
    designation: z.enum(PROMOTER_ROLE),
    ownershipPercent: optionalPercent,
    pan: optionalPan,
    aadhaarLast4: optionalAadhaarLast4,
    email: optionalEmail,
    phone: optionalPhone,
    dateOfBirth: optionalDate,
    addressLine1: optionalText(200),
    city: optionalText(100),
    pincode: optionalPincode,
    isPrimary: z.boolean().default(false),
  })
  .strict();
export type PromoterCreateInput = z.infer<typeof promoterCreateSchema>;

export const promoterUpdateSchema = promoterCreateSchema.partial().strict();
export type PromoterUpdateInput = z.infer<typeof promoterUpdateSchema>;

/** Shape returned by the API — identifiers are masked. */
export const clientSummarySchema = z.object({
  id: uuid,
  legalName: z.string(),
  tradeName: z.string().nullable(),
  entityType: z.string(),
  panMasked: z.string().nullable(),
  gstinMasked: z.string().nullable(),
  contactPersonName: z.string().nullable(),
  caseCount: z.number().optional(),
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type ClientSummary = z.infer<typeof clientSummarySchema>;
