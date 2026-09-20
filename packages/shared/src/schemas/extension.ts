import { z } from 'zod';
import { optionalText, requiredText, uuid } from './common';

/**
 * Browser extension contract.
 *
 * The constraints below are not style choices — they are the product's
 * non-negotiables expressed as a schema, so a future change has to argue with
 * a type rather than quietly slip past a code review:
 *
 *   - A captured control carrying a password, file or CAPTCHA-shaped identity
 *     is recorded as REFUSED and gets no selector to act on.
 *   - Nothing in this file can express "submit the form". There is no such
 *     field, no such action, and no endpoint that would accept one.
 *   - No credential for the portal is ever sent to us, so none is modelled.
 */

/* -------------------------------- pairing ------------------------------- */

export const pairingRedeemSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(4, 'Enter the pairing code')
      .max(20)
      .transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')),
    label: requiredText(120, 'Device name'),
    agentVersion: optionalText(32),
  })
  .strict();
export type PairingRedeemInput = z.infer<typeof pairingRedeemSchema>;

export const deviceRevokeSchema = z
  .object({ reason: optionalText(120) })
  .strict();
export type DeviceRevokeInput = z.infer<typeof deviceRevokeSchema>;

/* -------------------------------- capture ------------------------------- */

/**
 * A control as the extension found it on a real page.
 *
 * `selector` is captured, never invented. `refusedReason` is set by the
 * content script when it declines to record a control at all — the row still
 * exists so a CA can see WHY a box was left alone, but it carries nothing the
 * filler could act on.
 */
export const capturedFieldSchema = z
  .object({
    selector: requiredText(500, 'Selector'),
    controlType: z.enum(['input', 'select', 'textarea', 'radio', 'checkbox']),
    inputType: optionalText(24),
    labelText: optionalText(250),
    nameAttr: optionalText(200),
    idAttr: optionalText(200),
    required: z.boolean().default(false),
    maxLength: z.number().int().positive().max(100_000).optional().nullable(),
    options: z
      .array(z.object({ value: z.string().max(300), label: z.string().max(300) }))
      .max(2000)
      .optional()
      .nullable(),
    refusedReason: optionalText(120),
  })
  .strict()
  .superRefine((field, ctx) => {
    const looksSecret =
      ['password', 'file', 'hidden'].includes((field.inputType ?? '').toLowerCase()) ||
      [field.nameAttr, field.idAttr, field.labelText].some((v) =>
        (v ?? '').toLowerCase().includes('captcha'),
      );

    if (looksSecret && !field.refusedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['refusedReason'],
        message:
          'Password, file and CAPTCHA controls must be recorded as refused, never as fillable',
      });
    }
  });
export type CapturedFieldInput = z.infer<typeof capturedFieldSchema>;

export const formCaptureSchema = z
  .object({
    formCode: requiredText(64, 'Form code'),
    /** Echoed back by the extension so the server can check it matches. */
    host: requiredText(120, 'Host'),
    pathHint: optionalText(250),
    label: requiredText(80, 'Label'),
    note: optionalText(500),
    fields: z.array(capturedFieldSchema).min(1, 'Capture found no fields').max(500),
  })
  .strict();
export type FormCaptureInput = z.infer<typeof formCaptureSchema>;

/* -------------------------------- mapping ------------------------------- */

export const fieldMappingUpsertSchema = z
  .object({
    formFieldId: uuid,
    sourcePath: requiredText(120, 'Source path'),
    transform: optionalText(40),
    optionMap: z.record(z.string().max(300)).optional().nullable(),
    confirmed: z.boolean().default(false),
    note: optionalText(300),
  })
  .strict();
export type FieldMappingUpsertInput = z.infer<typeof fieldMappingUpsertSchema>;

export const formVersionStatusSchema = z
  .object({ status: z.enum(['CAPTURED', 'ACTIVE', 'RETIRED']) })
  .strict();
export type FormVersionStatusInput = z.infer<typeof formVersionStatusSchema>;

/* ------------------------------- telemetry ------------------------------ */

export const AUTOFILL_OUTCOME = [
  'FILLED',
  'MISSING',
  'NOT_EDITABLE',
  'NO_VALUE',
  'OPTION_NOT_FOUND',
  'REFUSED',
  'SKIPPED',
] as const;
export type AutofillOutcomeValue = (typeof AUTOFILL_OUTCOME)[number];

export const AUTOFILL_OUTCOME_LABEL: Record<AutofillOutcomeValue, string> = {
  FILLED: 'Filled',
  MISSING: 'Not on the page',
  NOT_EDITABLE: 'Not editable',
  NO_VALUE: 'No data',
  OPTION_NOT_FOUND: 'No matching option',
  REFUSED: 'Refused by policy',
  SKIPPED: 'Skipped',
};

export const autofillSessionStartSchema = z
  .object({
    caseId: uuid,
    formVersionId: uuid.optional(),
    /** Fingerprint of the page as the extension found it, for drift checks. */
    pageFingerprint: optionalText(64),
  })
  .strict();
export type AutofillSessionStartInput = z.infer<typeof autofillSessionStartSchema>;

/**
 * Per-field results. `sourcePath` is a NAME, and there is deliberately no
 * field here for what was typed — the value never comes back to us.
 */
export const autofillOutcomeSchema = z
  .object({
    sourcePath: requiredText(120, 'Source path'),
    selector: optionalText(500),
    outcome: z.enum(AUTOFILL_OUTCOME),
    detail: optionalText(250),
  })
  .strict();

export const autofillSessionFinishSchema = z
  .object({
    status: z.enum(['COMPLETED', 'ABANDONED']),
    outcomes: z.array(autofillOutcomeSchema).max(500),
  })
  .strict();
export type AutofillSessionFinishInput = z.infer<typeof autofillSessionFinishSchema>;
