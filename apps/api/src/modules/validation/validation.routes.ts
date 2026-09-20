import { Router } from 'express';
import { findingWaiveSchema, type FindingWaiveInput } from '@ifp/shared';
import { db, getAuth } from '../../auth/context';
import { authenticate, authorize, handler, rateLimits, valid, validate } from '../../middleware';
import { enforceLicense } from '../../services/license/license';
import { writeAudit } from '../../services/audit/auditWriter';
import { forbidden, notFound } from '../../utils/problem';

export const validationRouter = Router();
validationRouter.use(authenticate());
validationRouter.use(enforceLicense());

/** Latest run for a case, with findings grouped by severity. */
validationRouter.get(
  '/cases/:caseId/latest',
  authorize('case:read'),
  rateLimits.read,
  handler(async (req, res) => {
    const caseId = req.params.caseId!;

    const run = await db().caseValidationRun.findFirst({
      where: { caseId },
      orderBy: { id: 'desc' },
      include: {
        findings: {
          include: {
            ruleVersion: {
              select: {
                id: true,
                remediationHint: true,
                sourceReference: true,
                rule: { select: { code: true, name: true, category: true } },
              },
            },
          },
          orderBy: { severity: 'asc' },
        },
        triggeredBy: { select: { id: true, fullName: true } },
      },
    });

    if (!run) {
      res.json(null);
      return;
    }

    res.json({
      id: run.id,
      caseId: run.caseId,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      trigger: run.trigger,
      blockingCount: run.blockingCount,
      warningCount: run.warningCount,
      infoCount: run.infoCount,
      readinessScore: run.readinessScore,
      rulesetHash: run.rulesetHash,
      triggeredBy: run.triggeredBy,
      findings: run.findings.map((f) => ({
        id: f.id,
        ruleCode: f.ruleVersion.rule.code,
        ruleName: f.ruleVersion.rule.name,
        category: f.ruleVersion.rule.category,
        severity: f.severity,
        message: f.message,
        remediationHint: f.ruleVersion.remediationHint,
        sourceReference: f.ruleVersion.sourceReference,
        fieldCode: f.fieldCode,
        section: f.section,
        status: f.status,
        waiverReason: f.waiverReason,
      })),
    });
  }),
);

/**
 * Waive a finding. WARNING and INFO only — a firm user can never waive a
 * BLOCKING finding, because those are the ones that stop a bad filing.
 */
validationRouter.post(
  '/findings/:id/waive',
  authorize('validation:waive'),
  rateLimits.write,
  validate(findingWaiveSchema),
  handler(async (req, res) => {
    const id = req.params.id!;
    const body = valid<FindingWaiveInput>(req);
    const { userId } = getAuth();

    const finding = await db().caseValidationFinding.findFirst({
      where: { id },
      include: { ruleVersion: { select: { rule: { select: { code: true } } } } },
    });
    if (!finding) throw notFound('That finding');

    if (finding.severity === 'BLOCKING') {
      throw forbidden('Blocking findings cannot be waived — they must be resolved');
    }
    if (finding.status === 'WAIVED') {
      res.json({ id, status: 'WAIVED' });
      return;
    }

    await db().caseValidationFinding.update({
      where: { id },
      data: {
        status: 'WAIVED',
        waivedByUserId: userId,
        waivedAt: new Date(),
        waiverReason: body.reason,
      },
    });

    await writeAudit({
      action: 'VALIDATION_WAIVED',
      entityType: 'case_validation_finding',
      entityId: id,
      metadata: {
        ruleCode: finding.ruleVersion.rule.code,
        severity: finding.severity,
        reason: body.reason,
      },
    });

    res.json({ id, status: 'WAIVED' });
  }),
);

/** The active ruleset, so the UI can explain what will be checked. */
validationRouter.get(
  '/rules',
  authorize('case:read'),
  rateLimits.read,
  handler(async (_req, res) => {
    const versions = await db().validationRuleVersion.findMany({
      where: { status: 'ACTIVE' },
      include: { rule: { select: { code: true, name: true, category: true } } },
      orderBy: { id: 'asc' },
    });

    res.json(
      versions.map((v) => ({
        code: v.rule.code,
        name: v.rule.name,
        category: v.rule.category,
        severity: v.severity,
        message: v.messageTemplate,
        remediationHint: v.remediationHint,
        sourceReference: v.sourceReference,
        section: v.section,
        fieldCode: v.fieldCode,
        params: v.params,
      })),
    );
  }),
);

/**
 * Rules that exist but are NOT running, with the reason. Surfaced in the UI so
 * nobody assumes eligibility has been checked when it has not.
 */
validationRouter.get(
  '/rules/inactive',
  authorize('case:read'),
  rateLimits.read,
  handler(async (_req, res) => {
    const versions = await db().validationRuleVersion.findMany({
      where: { status: 'DRAFT' },
      include: { rule: { select: { code: true, name: true, category: true } } },
      orderBy: { id: 'asc' },
    });

    res.json(
      versions.map((v) => ({
        code: v.rule.code,
        name: v.rule.name,
        category: v.rule.category,
        severity: v.severity,
        reason: v.sourceReference
          ? 'Draft — not yet published'
          : 'Awaiting the governing resolution citation before it can be applied',
      })),
    );
  }),
);
