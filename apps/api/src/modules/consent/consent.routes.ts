import { Router } from 'express';
import { createHash } from 'node:crypto';
import {
  consentRecordSchema,
  consentWithdrawSchema,
  uuidv7,
  type ConsentRecordInput,
  type ConsentWithdrawInput,
} from '@ifp/shared';
import { db, getAuth, getContext } from '../../auth/context';
import { authenticate, authorize, handler, rateLimits, valid, validate } from '../../middleware';
import { enforceLicense } from '../../services/license/license';
import { writeAudit } from '../../services/audit/auditWriter';
import { badRequest, conflict, notFound } from '../../utils/problem';

export const consentRouter = Router();
consentRouter.use(authenticate());
consentRouter.use(enforceLicense());

/**
 * What this endpoint stores is EVIDENCE OF AN ATTESTATION BY THE CA that they
 * hold client authorization. Whether that satisfies DPDP obligations, and who
 * the Data Fiduciary is, are legal determinations (tasks XC-003 / XC-004).
 * The template carries an explicit "not legally reviewed" flag until then.
 */

consentRouter.get(
  '/templates/active',
  rateLimits.read,
  handler(async (_req, res) => {
    const template = await db().consentTemplate.findFirst({
      where: { isActive: true, language: 'en' },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!template) throw notFound('An active consent template');

    res.json({
      id: template.id,
      code: template.code,
      versionLabel: template.versionLabel,
      language: template.language,
      bodyText: template.bodyText,
      purposeCodes: template.purposeCodes,
      isDraftText: template.isDraftText,
      warning: template.isDraftText
        ? 'This wording has NOT been reviewed by a legal adviser. Do not rely on it with real client data.'
        : null,
    });
  }),
);

consentRouter.get(
  '/records',
  authorize('case:read'),
  rateLimits.read,
  handler(async (req, res) => {
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
    const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
    if (!clientId && !caseId) throw badRequest('Provide clientId or caseId');

    const rows = await db().consentRecord.findMany({
      where: { ...(clientId ? { clientId } : {}), ...(caseId ? { caseId } : {}) },
      include: {
        template: { select: { code: true, versionLabel: true, language: true } },
        recordedBy: { select: { id: true, fullName: true } },
        client: { select: { id: true, legalName: true } },
      },
      orderBy: { recordedAt: 'desc' },
      take: 50,
    });

    res.json(
      rows.map((r) => ({
        id: r.id,
        clientId: r.clientId,
        clientName: r.client.legalName,
        caseId: r.caseId,
        status: r.status,
        method: r.method,
        recordedAt: r.recordedAt.toISOString(),
        recordedBy: r.recordedBy,
        template: r.template,
        attestationText: r.attestationText,
        validUntil: r.validUntil?.toISOString().slice(0, 10) ?? null,
        withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
        withdrawnReason: r.withdrawnReason,
      })),
    );
  }),
);

consentRouter.post(
  '/records',
  authorize('consent:record'),
  rateLimits.write,
  validate(consentRecordSchema),
  handler(async (req, res) => {
    const body = valid<ConsentRecordInput>(req);
    const { firmId, userId } = getAuth();
    const ctx = getContext();

    const client = await db().client.findFirst({
      where: { id: body.clientId, deletedAt: null },
      select: { id: true, legalName: true },
    });
    if (!client) throw notFound('That client');

    if (body.caseId) {
      const caseRow = await db().case.findFirst({
        where: { id: body.caseId, clientId: body.clientId, deletedAt: null },
        select: { id: true },
      });
      if (!caseRow) throw notFound('That case');

      const existing = await db().consentRecord.findFirst({
        where: { caseId: body.caseId, status: 'RECORDED' },
        select: { id: true },
      });
      if (existing) {
        throw conflict(
          'An authorization has already been recorded for this case',
          'Withdraw the existing record first if it needs to be replaced.',
          existing.id,
        );
      }
    }

    const template = await db().consentTemplate.findFirst({
      where: { id: body.templateId },
      select: { id: true, versionLabel: true, bodyText: true, bodySha256: true },
    });
    if (!template) throw notFound('That consent template');

    // The client echoes back the exact text it displayed. If it does not match
    // the stored template, refuse — we will not record an attestation to
    // wording we cannot reproduce.
    const shownHash = createHash('sha256').update(body.attestationText, 'utf8').digest();
    const storedHash = Buffer.from(template.bodySha256);
    if (!shownHash.equals(storedHash)) {
      throw badRequest(
        'The authorization text has changed since this page was opened',
        'Reload the consent step and read the current wording before confirming.',
      );
    }

    const id = uuidv7();
    await db().consentRecord.create({
      data: {
        id,
        firmId,
        clientId: body.clientId,
        caseId: body.caseId ?? null,
        templateId: template.id,
        status: 'RECORDED',
        method: body.method,
        attestationText: body.attestationText,
        templateSha256: storedHash,
        recordedByUserId: userId,
        clientContactName: body.clientContactName ?? null,
        ipAddress: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        notes: body.notes ?? null,
      },
    });

    await writeAudit({
      action: 'CONSENT_RECORDED',
      entityType: 'consent_record',
      entityId: id,
      metadata: {
        clientName: client.legalName,
        templateVersion: template.versionLabel,
        consentMethod: body.method,
      },
    });

    res.status(201).json({ id, status: 'RECORDED' });
  }),
);

consentRouter.post(
  '/records/:id/withdraw',
  authorize('consent:record'),
  rateLimits.write,
  validate(consentWithdrawSchema),
  handler(async (req, res) => {
    const id = req.params.id!;
    const body = valid<ConsentWithdrawInput>(req);

    const record = await db().consentRecord.findFirst({
      where: { id },
      select: { id: true, status: true, clientId: true },
    });
    if (!record) throw notFound('That consent record');
    if (record.status !== 'RECORDED') throw badRequest('That record is not active');

    await db().consentRecord.update({
      where: { id },
      data: {
        status: 'WITHDRAWN',
        withdrawnAt: new Date(),
        withdrawnReason: body.reason,
      },
    });

    await writeAudit({
      action: 'CONSENT_WITHDRAWN',
      entityType: 'consent_record',
      entityId: id,
      metadata: { reason: body.reason },
    });

    // Withdrawal deliberately does NOT delete data. What must happen next is a
    // documented procedure, not an automatic cascade — see the privacy plan.
    res.json({
      id,
      status: 'WITHDRAWN',
      notice:
        'Consent is marked withdrawn. Data has not been deleted automatically — follow the firm procedure for handling a withdrawal.',
    });
  }),
);
