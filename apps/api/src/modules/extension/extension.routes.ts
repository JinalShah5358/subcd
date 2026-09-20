import { Router } from 'express';
import { createHash } from 'node:crypto';
import {
  autofillSessionFinishSchema,
  autofillSessionStartSchema,
  deviceRevokeSchema,
  fieldMappingUpsertSchema,
  formCaptureSchema,
  formVersionStatusSchema,
  pairingRedeemSchema,
  uuidv7,
  type AutofillSessionFinishInput,
  type AutofillSessionStartInput,
  type DeviceRevokeInput,
  type FieldMappingUpsertInput,
  type FormCaptureInput,
  type FormVersionStatusInput,
  type PairingRedeemInput,
} from '@ifp/shared';
import { db, getAuth, getContext } from '../../auth/context';
import {
  authenticateDevice,
  currentDeviceId,
  issuePairingCode,
  redeemPairingCode,
  registerDevice,
  PAIRING_CODE_TTL_MINUTES,
} from '../../auth/device';
import { authenticate, authorize, handler, rateLimits, valid, validate } from '../../middleware';
import { enforceLicense } from '../../services/license/license';
import { writeAudit } from '../../services/audit/auditWriter';
import {
  SOURCE_PATHS,
  TRANSFORM_NAMES,
  applyTransform,
  buildCasePayload,
  isSourcePath,
} from '../../services/extension/payload';
import { badRequest, forbidden, notFound } from '../../utils/problem';

/**
 * The browser-extension API.
 *
 * Two audiences, two authentication schemes:
 *
 *   /extension/pairing-codes, /extension/devices   the WEB app, Bearer token
 *   everything else                                the EXTENSION, Device token
 *
 * What is not here is as deliberate as what is. There is no endpoint that
 * submits a form, none that accepts or returns an IFP credential or session
 * cookie, none that takes CAPTCHA content, and none that reports back the
 * VALUE the extension typed into a box. Those are not omissions to be filled
 * in later; they are the product constraints.
 */
export const extensionRouter = Router();

/* ------------------------- pairing (web app side) ----------------------- */
//
// Middleware is attached per route, not with router.use(). A router-level
// use() runs for every path under that router — which meant the extension's
// unauthenticated /pair was rejected by the WEB app's authenticate() before
// Express ever looked at the path.

/**
 * Mints a short pairing code.
 *
 * `case:read` rather than an admin permission: pairing a browser grants the
 * extension exactly the permissions the user already has, so anyone who can
 * work a case can pair the browser they work it in.
 */
extensionRouter.post(
  '/pairing-codes',
  authenticate(),
  enforceLicense(),
  authorize('case:read'),
  rateLimits.write,
  handler(async (_req, res) => {
    const { firmId, userId } = getAuth();
    const { code, expiresAt } = issuePairingCode(firmId, userId);

    await writeAudit({
      action: 'EXTENSION_PAIRING_STARTED',
      entityType: 'extension_device',
      metadata: { ttlMinutes: PAIRING_CODE_TTL_MINUTES },
    });

    res.status(201).json({
      code,
      expiresAt: expiresAt.toISOString(),
      ttlMinutes: PAIRING_CODE_TTL_MINUTES,
    });
  }),
);

extensionRouter.get(
  '/devices',
  authenticate(),
  // Paired browsers are firm data. These two routes relied on authentication
  // alone, which was invisible while 'platform:admin' was a wildcard over
  // every permission; with that gone they need the same permission as the
  // pairing route they belong to.
  authorize('case:read'),
  rateLimits.read,
  handler(async (_req, res) => {
    const { userId } = getAuth();
    const rows = await db().extensionDevice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        agentVersion: true,
        lastSeenAt: true,
        revokedAt: true,
        revokedReason: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    res.json(
      rows.map((d) => ({
        ...d,
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        revokedAt: d.revokedAt?.toISOString() ?? null,
        expiresAt: d.expiresAt.toISOString(),
        createdAt: d.createdAt.toISOString(),
        expired: d.expiresAt.getTime() < Date.now(),
      })),
    );
  }),
);

extensionRouter.delete(
  '/devices/:id',
  authenticate(),
  authorize('case:read'),
  enforceLicense(),
  rateLimits.write,
  validate(deviceRevokeSchema),
  handler(async (req, res) => {
    const body = valid<DeviceRevokeInput>(req);
    const { userId } = getAuth();
    const id = String(req.params.id);

    // Scoped to the caller's own devices: unpairing someone else's browser is
    // not a thing this endpoint does.
    const updated = await db().extensionDevice.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: body.reason ?? 'Unpaired by the user' },
    });
    if (updated.count === 0) throw notFound('That device');

    await writeAudit({
      action: 'EXTENSION_DEVICE_REVOKED',
      entityType: 'extension_device',
      entityId: id,
      changedFields: ['revokedAt'],
    });

    res.status(204).send();
  }),
);

/* ---------------------- pairing redemption (no auth) -------------------- */

/**
 * Exchanges a pairing code for a device credential.
 *
 * Unauthenticated by necessity — the extension has nothing yet. The code is
 * the only thing that gets it anywhere: eight characters, ten minutes, single
 * use, and it only exists because someone already signed in asked for it.
 */
extensionRouter.post(
  '/pair',
  rateLimits.login,
  validate(pairingRedeemSchema),
  handler(async (req, res) => {
    const body = valid<PairingRedeemInput>(req);

    const claim = redeemPairingCode(body.code);
    if (!claim) throw badRequest('That pairing code is wrong or has expired');

    const device = await registerDevice({
      firmId: claim.firmId,
      userId: claim.userId,
      label: body.label,
      agentVersion: body.agentVersion ?? undefined,
      ip: getContext().ip,
    });

    await writeAudit({
      action: 'EXTENSION_DEVICE_PAIRED',
      entityType: 'extension_device',
      entityId: device.deviceId,
      firmId: claim.firmId,
      actorUserId: claim.userId,
      changedFields: ['label', 'secretHash'],
      metadata: { label: body.label, agentVersion: body.agentVersion ?? null },
    });

    // The secret is returned exactly once and never stored in plaintext.
    res.status(201).json({
      deviceId: device.deviceId,
      deviceSecret: device.deviceSecret,
      expiresAt: device.expiresAt.toISOString(),
    });
  }),
);

/* ----------------------- everything the extension uses ------------------ */

extensionRouter.get(
  '/me',
  authenticateDevice(),
  rateLimits.read,
  handler(async (_req, res) => {
    const auth = getAuth();
    const firm = await db().firm.findFirst({ select: { id: true, name: true, slug: true } });
    const forms = await db().formDefinition.findMany({
      select: { id: true, code: true, name: true, host: true, pathHint: true },
      orderBy: { code: 'asc' },
    });

    res.json({
      user: { id: auth.userId, email: auth.email, roleKey: auth.roleKey },
      firm,
      permissions: auth.permissions,
      // The extension activates on these hosts and nowhere else.
      hosts: [...new Set(forms.map((f) => f.host))],
      forms,
      sourcePaths: SOURCE_PATHS,
      transforms: TRANSFORM_NAMES,
    });
  }),
);

/**
 * The mapping the extension should use for a form.
 *
 * Prefers the firm's own captured version over the shared catalog, so a firm
 * that has captured the page it actually sees is not held back by a curated
 * mapping that is a week out of date.
 */
extensionRouter.get(
  '/forms/:code/mapping',
  authenticateDevice(),
  rateLimits.read,
  handler(async (req, res) => {
    const code = String(req.params.code);

    const form = await db().formDefinition.findFirst({ where: { code } });
    if (!form) throw notFound('That form');

    const versions = await db().formVersion.findMany({
      where: { formId: form.id, status: 'ACTIVE' },
      orderBy: [{ capturedAt: 'desc' }],
      include: {
        fields: { orderBy: { sortOrder: 'asc' } },
        mappings: true,
      },
    });

    // A firm's own ACTIVE capture wins over the curated one.
    const version = versions.find((v) => v.firmId !== null) ?? versions[0];
    if (!version) {
      return res.json({
        form: { id: form.id, code: form.code, name: form.name, host: form.host },
        version: null,
        instructions:
          'No mapping has been captured for this form yet. Open the form and use "Learn this page" in the extension.',
      });
    }

    const fieldById = new Map(version.fields.map((f) => [f.id, f]));

    res.json({
      form: { id: form.id, code: form.code, name: form.name, host: form.host },
      version: {
        id: version.id,
        label: version.label,
        fingerprint: version.fingerprint,
        capturedAt: version.capturedAt.toISOString(),
        isFirmCapture: version.firmId !== null,
      },
      mappings: version.mappings
        .map((m) => {
          const field = fieldById.get(m.formFieldId);
          // A refused control never gets a selector handed back, whatever a
          // mapping row says.
          if (!field || field.refusedReason) return null;
          return {
            sourcePath: m.sourcePath,
            selector: field.selector,
            controlType: field.controlType,
            inputType: field.inputType,
            transform: m.transform,
            optionMap: m.optionMap,
            confirmed: m.confirmed,
            labelText: field.labelText,
          };
        })
        .filter(Boolean),
      refused: version.fields
        .filter((f) => f.refusedReason)
        .map((f) => ({ labelText: f.labelText, reason: f.refusedReason })),
    });
  }),
);

/**
 * Cases the signed-in user might be working on at the portal.
 *
 * Drafts are included, because a CA transcribing a form often wants the data
 * in front of them before a case is finished. The popup shows the status and
 * readiness beside each one and warns before filling an unready case — that
 * is a judgement for the person, not a list this endpoint should silently
 * make for them. Filed and archived cases are excluded: there is nothing left
 * to fill.
 */
extensionRouter.get(
  '/cases',
  authenticateDevice(),
  authorize('case:read'),
  rateLimits.read,
  handler(async (_req, res) => {
    const rows = await db().case.findMany({
      where: { status: { in: ['DRAFT', 'IN_REVIEW', 'READY_TO_FILE', 'QUERY_RAISED'] } },
      orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        caseNumber: true,
        status: true,
        readinessScore: true,
        updatedAt: true,
        client: { select: { legalName: true } },
      },
    });

    res.json(
      rows.map((c) => ({
        id: c.id,
        caseNumber: c.caseNumber,
        clientName: c.client.legalName,
        status: c.status,
        readinessScore: c.readinessScore,
        updatedAt: c.updatedAt.toISOString(),
      })),
    );
  }),
);

/**
 * The values for one case.
 *
 * `sensitive:reveal` and an audit row, because this is the one place real
 * identifiers leave the platform unmasked. A CA who may not reveal a PAN in
 * the web app may not obtain one through the extension either.
 */
extensionRouter.get(
  '/cases/:id/payload',
  authenticateDevice(),
  authorize('sensitive:reveal'),
  rateLimits.reveal,
  handler(async (req, res) => {
    const caseId = String(req.params.id);
    const payload = await buildCasePayload(caseId, true);

    await writeAudit({
      action: 'SENSITIVE_FIELD_REVEALED',
      entityType: 'case',
      entityId: caseId,
      // Paths, not values. The canary test asserts this stays true.
      changedFields: payload.sensitiveReleased,
      metadata: {
        via: 'extension',
        caseNumber: payload.caseNumber,
        pathCount: Object.keys(payload.values).length,
      },
    });

    res.json(payload);
  }),
);

/* -------------------------------- capture ------------------------------- */

/**
 * Records a captured page.
 *
 * The extension enumerates what it finds on the CA's own authenticated page
 * and posts the structure — selectors, labels, option lists. No values, and
 * no page content beyond the form controls themselves.
 */
extensionRouter.post(
  '/captures',
  authenticateDevice(),
  enforceLicense(),
  authorize('case:write'),
  rateLimits.write,
  validate(formCaptureSchema),
  handler(async (req, res) => {
    const body = valid<FormCaptureInput>(req);
    const { firmId, userId } = getAuth();

    const form = await db().formDefinition.findFirst({ where: { code: body.formCode } });
    if (!form) throw notFound('That form');
    if (form.host.toLowerCase() !== body.host.toLowerCase()) {
      // The extension reported a host other than the one this form lives on.
      throw forbidden('That capture did not come from this form’s host');
    }

    // Fingerprint the SHAPE, so re-capturing an unchanged page is recognisable
    // and a changed page is obvious.
    const fingerprint = createHash('sha256')
      .update(
        body.fields
          .map((f) => `${f.controlType}|${f.inputType ?? ''}|${f.nameAttr ?? ''}|${f.idAttr ?? ''}`)
          .sort()
          .join('\n'),
      )
      .digest('hex');

    const versionId = uuidv7();
    await db().formVersion.create({
      data: {
        id: versionId,
        firmId,
        formId: form.id,
        label: body.label,
        status: 'CAPTURED',
        fingerprint,
        capturedAt: new Date(),
        capturedByUserId: userId,
        note: body.note ?? null,
      },
    });

    await db().formField.createMany({
      data: body.fields.map((f, i) => ({
        id: uuidv7(),
        firmId,
        formVersionId: versionId,
        // A refused control keeps a placeholder selector it cannot act on, so
        // the CA can still see the box existed and why it was left alone.
        selector: f.refusedReason ? '(refused)' : f.selector,
        controlType: f.controlType,
        inputType: f.inputType ?? null,
        labelText: f.labelText ?? null,
        nameAttr: f.nameAttr ?? null,
        idAttr: f.idAttr ?? null,
        required: f.required,
        maxLength: f.maxLength ?? null,
        options: f.options ?? undefined,
        refusedReason: f.refusedReason ?? null,
        sortOrder: i,
      })),
    });

    await writeAudit({
      action: 'FORM_CAPTURED',
      entityType: 'form_version',
      entityId: versionId,
      changedFields: ['fingerprint', 'fields'],
      metadata: {
        formCode: body.formCode,
        fieldCount: body.fields.length,
        refusedCount: body.fields.filter((f) => f.refusedReason).length,
        fingerprint,
      },
    });

    res.status(201).json({
      id: versionId,
      fingerprint,
      fieldCount: body.fields.length,
      refusedCount: body.fields.filter((f) => f.refusedReason).length,
    });
  }),
);

/* ------------------------------- sessions ------------------------------- */

extensionRouter.post(
  '/sessions',
  authenticateDevice(),
  enforceLicense(),
  authorize('case:read'),
  rateLimits.write,
  validate(autofillSessionStartSchema),
  handler(async (req, res) => {
    const body = valid<AutofillSessionStartInput>(req);
    const { firmId, userId } = getAuth();

    const kase = await db().case.findFirst({
      where: { id: body.caseId },
      select: { id: true, caseNumber: true },
    });
    if (!kase) throw notFound('That case');

    let driftDetected = false;
    if (body.formVersionId && body.pageFingerprint) {
      const version = await db().formVersion.findFirst({
        where: { id: body.formVersionId },
        select: { fingerprint: true },
      });
      // The page no longer matches what was captured. Recorded, not blocked —
      // the CA is about to review every field anyway, and refusing to help
      // would be worse than helping with a warning.
      driftDetected = Boolean(version && version.fingerprint !== body.pageFingerprint);
    }

    const id = uuidv7();
    await db().autofillSession.create({
      data: {
        id,
        firmId,
        caseId: body.caseId,
        userId,
        deviceId: currentDeviceId() ?? null,
        formVersionId: body.formVersionId ?? null,
        status: 'STARTED',
        driftDetected,
      },
    });

    res.status(201).json({ id, driftDetected, caseNumber: kase.caseNumber });
  }),
);

extensionRouter.post(
  '/sessions/:id/finish',
  authenticateDevice(),
  enforceLicense(),
  authorize('case:read'),
  rateLimits.write,
  validate(autofillSessionFinishSchema),
  handler(async (req, res) => {
    const body = valid<AutofillSessionFinishInput>(req);
    const { firmId } = getAuth();
    const id = String(req.params.id);

    const session = await db().autofillSession.findFirst({
      where: { id },
      select: { id: true, caseId: true, status: true, driftDetected: true },
    });
    if (!session) throw notFound('That session');
    if (session.status !== 'STARTED') throw badRequest('That session is already closed');

    const filled = body.outcomes.filter((o) => o.outcome === 'FILLED').length;
    const failed = body.outcomes.filter((o) =>
      ['MISSING', 'OPTION_NOT_FOUND', 'NOT_EDITABLE'].includes(o.outcome),
    ).length;

    if (body.outcomes.length > 0) {
      await db().autofillFieldOutcome.createMany({
        data: body.outcomes.map((o) => ({
          id: uuidv7(),
          firmId,
          sessionId: id,
          sourcePath: o.sourcePath,
          selector: o.selector ?? null,
          outcome: o.outcome,
          detail: o.detail ?? null,
        })),
      });
    }

    await db().autofillSession.update({
      where: { id },
      data: {
        status: body.status,
        fieldsAttempted: body.outcomes.length,
        fieldsFilled: filled,
        fieldsFailed: failed,
        finishedAt: new Date(),
      },
    });

    await writeAudit({
      action: 'AUTOFILL_COMPLETED',
      entityType: 'case',
      entityId: session.caseId,
      outcome: body.status === 'COMPLETED' ? 'SUCCESS' : 'FAILURE',
      // Names only: which paths were attempted, never what went into them.
      changedFields: body.outcomes.filter((o) => o.outcome === 'FILLED').map((o) => o.sourcePath),
      metadata: {
        sessionId: id,
        attempted: body.outcomes.length,
        filled,
        failed,
        driftDetected: session.driftDetected,
        // Stated plainly in the trail, every time.
        submitted: false,
      },
    });

    res.json({ id, status: body.status, filled, failed });
  }),
);


/* ------------------------ field mapping (web app) ----------------------- */

/**
 * Reviewing a capture and binding its controls to our data.
 *
 * This is a human step on purpose. A captured page is a list of boxes with
 * labels like "Name of Applicant (as per PAN)"; deciding that box takes
 * `client.legalName` is a judgement, and one wrong binding types a PAN into a
 * turnover field on a government form. So nothing is auto-mapped, and a
 * version stays inert until someone activates it.
 */

extensionRouter.get(
  '/form-versions',
  authenticate(),
  authorize('case:write'),
  rateLimits.read,
  handler(async (_req, res) => {
    const rows = await db().formVersion.findMany({
      orderBy: { capturedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        label: true,
        status: true,
        fingerprint: true,
        capturedAt: true,
        note: true,
        firmId: true,
        form: { select: { code: true, name: true, host: true } },
        _count: { select: { fields: true, mappings: true } },
      },
    });

    res.json(
      rows.map((v) => ({
        id: v.id,
        label: v.label,
        status: v.status,
        fingerprint: v.fingerprint.slice(0, 12),
        capturedAt: v.capturedAt.toISOString(),
        note: v.note,
        isShared: v.firmId === null,
        form: v.form,
        fieldCount: v._count.fields,
        mappedCount: v._count.mappings,
      })),
    );
  }),
);

extensionRouter.get(
  '/form-versions/:id',
  authenticate(),
  authorize('case:write'),
  rateLimits.read,
  handler(async (req, res) => {
    const id = String(req.params.id);
    const version = await db().formVersion.findFirst({
      where: { id },
      include: {
        form: { select: { code: true, name: true, host: true } },
        fields: { orderBy: { sortOrder: 'asc' } },
        mappings: true,
      },
    });
    if (!version) throw notFound('That capture');

    const mappingByField = new Map(version.mappings.map((m) => [m.formFieldId, m]));

    res.json({
      id: version.id,
      label: version.label,
      status: version.status,
      note: version.note,
      capturedAt: version.capturedAt.toISOString(),
      isShared: version.firmId === null,
      form: version.form,
      sourcePaths: SOURCE_PATHS,
      transforms: TRANSFORM_NAMES,
      fields: version.fields.map((f) => {
        const m = mappingByField.get(f.id);
        return {
          id: f.id,
          selector: f.selector,
          controlType: f.controlType,
          inputType: f.inputType,
          labelText: f.labelText,
          nameAttr: f.nameAttr,
          idAttr: f.idAttr,
          required: f.required,
          maxLength: f.maxLength,
          options: f.options,
          refusedReason: f.refusedReason,
          mapping: m
            ? {
                id: m.id,
                sourcePath: m.sourcePath,
                transform: m.transform,
                optionMap: m.optionMap,
                confirmed: m.confirmed,
                note: m.note,
              }
            : null,
        };
      }),
    });
  }),
);

extensionRouter.put(
  '/form-versions/:id/mappings',
  authenticate(),
  enforceLicense(),
  authorize('case:write'),
  rateLimits.write,
  validate(fieldMappingUpsertSchema),
  handler(async (req, res) => {
    const body = valid<FieldMappingUpsertInput>(req);
    const versionId = String(req.params.id);
    const { firmId } = getAuth();

    if (!isSourcePath(body.sourcePath)) throw badRequest('That is not a known data path');
    if (body.transform && !TRANSFORM_NAMES.includes(body.transform)) {
      throw badRequest('That is not a known transform');
    }

    const field = await db().formField.findFirst({
      where: { id: body.formFieldId, formVersionId: versionId },
      select: { id: true, refusedReason: true, labelText: true },
    });
    if (!field) throw notFound('That field');

    // The refusal set is decided at capture time by the content script and is
    // not negotiable here: a control that was refused stays unmapped, so no
    // amount of UI can bind a value to a password box.
    if (field.refusedReason) {
      throw forbidden(`That control was refused at capture: ${field.refusedReason}`);
    }

    const existing = await db().fieldMapping.findFirst({
      where: { formFieldId: field.id },
      select: { id: true },
    });

    const data = {
      sourcePath: body.sourcePath,
      transform: body.transform ?? null,
      optionMap: body.optionMap ?? undefined,
      confirmed: body.confirmed,
      note: body.note ?? null,
    };

    if (existing) {
      await db().fieldMapping.update({ where: { id: existing.id }, data });
    } else {
      await db().fieldMapping.create({
        data: {
          id: uuidv7(),
          firmId,
          formVersionId: versionId,
          formFieldId: field.id,
          ...data,
        },
      });
    }

    await writeAudit({
      action: 'FIELD_MAPPED',
      entityType: 'field_mapping',
      entityId: field.id,
      changedFields: ['sourcePath', 'transform', 'confirmed'],
      metadata: { sourcePath: body.sourcePath, label: field.labelText },
    });

    res.json({ formFieldId: field.id, ...data });
  }),
);

extensionRouter.delete(
  '/form-versions/:id/mappings/:fieldId',
  authenticate(),
  enforceLicense(),
  authorize('case:write'),
  rateLimits.write,
  handler(async (req, res) => {
    const removed = await db().fieldMapping.deleteMany({
      where: {
        formVersionId: String(req.params.id),
        formFieldId: String(req.params.fieldId),
      },
    });
    if (removed.count === 0) throw notFound('That mapping');
    res.status(204).send();
  }),
);

/**
 * Activating a capture is what makes the extension use it.
 *
 * Activating retires the firm's other ACTIVE versions of the same form, so
 * there is never an ambiguous answer to "which map applies".
 */
extensionRouter.patch(
  '/form-versions/:id/status',
  authenticate(),
  enforceLicense(),
  authorize('case:write'),
  rateLimits.write,
  validate(formVersionStatusSchema),
  handler(async (req, res) => {
    const body = valid<FormVersionStatusInput>(req);
    const id = String(req.params.id);

    const version = await db().formVersion.findFirst({
      where: { id },
      select: { id: true, formId: true, label: true, status: true },
    });
    if (!version) throw notFound('That capture');

    if (body.status === 'ACTIVE') {
      const confirmed = await db().fieldMapping.count({
        where: { formVersionId: id, confirmed: true },
      });
      // Activating a capture nobody has checked would point the filler at
      // bindings that were never reviewed.
      if (confirmed === 0) {
        throw badRequest('Confirm at least one field mapping before activating this capture');
      }

      await db().formVersion.updateMany({
        where: { formId: version.formId, status: 'ACTIVE', id: { not: id } },
        data: { status: 'RETIRED' },
      });
    }

    await db().formVersion.update({ where: { id }, data: { status: body.status } });

    await writeAudit({
      action: 'FORM_VERSION_STATUS_CHANGED',
      entityType: 'form_version',
      entityId: id,
      changedFields: ['status'],
      metadata: { from: version.status, to: body.status, label: version.label },
    });

    res.json({ id, status: body.status });
  }),
);

/* --------------------------- helper for mapping ------------------------- */

export { applyTransform };
