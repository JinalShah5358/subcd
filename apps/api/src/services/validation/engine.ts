import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  PAN_FOURTH_CHAR_BY_ENTITY,
  gstinChecksumValid,
  panFromGstin,
  uuidv7,
  type EntityType,
} from '@ifp/shared';
import { db } from '../../auth/context';
import { decryptField } from '../crypto';
import { logger } from '../../utils/logger';
import { notFound } from '../../utils/problem';
import { evaluate, RuleEvaluationError, type ValueMap } from './operators';

/**
 * Validation engine.
 *
 * Guarantees:
 *   - pure function of (case data, ruleset, today) — reproducible and testable
 *   - no network calls, one clock read, injected
 *   - messages name FIELDS, never values
 *   - a rule that throws is logged and skipped, never fails the whole run
 */

export interface FindingDraft {
  ruleVersionId: string;
  ruleCode: string;
  ruleName: string;
  severity: 'BLOCKING' | 'WARNING' | 'INFO';
  category: string;
  message: string;
  remediationHint: string | null;
  fieldCode: string | null;
  section: string | null;
  sourceReference: string | null;
}

export interface RunResult {
  runId: string;
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  readinessScore: number;
  rulesetHash: string;
  findings: FindingDraft[];
}

const decimal = (v: Prisma.Decimal | null | undefined): string | null => (v ? v.toString() : null);
const dateStr = (d: Date | null | undefined): string | null => d?.toISOString().slice(0, 10) ?? null;

/* -------------------------- value map assembly -------------------------- */

export async function buildValueMap(caseId: string, firmId: string): Promise<ValueMap> {
  const row = await db().case.findFirst({
    where: { id: caseId, deletedAt: null },
    include: {
      client: {
        include: {
          promoters: {
            select: { ownershipPercent: true, isPrimary: true, fullName: true, panLast4: true },
          },
        },
      },
      project: true,
      loan: true,
      employment: true,
      investment: true,
      firstSale: true,
      documents: { include: { documentType: { select: { code: true, name: true } } } },
      consents: { where: { status: 'RECORDED' }, select: { id: true, validUntil: true } },
    },
  });

  if (!row) throw notFound('That case');

  // Decrypt only the identifiers the rules actually reference.
  const pan = await decryptField(row.client.panEnc, {
    firmId,
    table: 'client',
    column: 'pan_enc',
    rowId: row.client.id,
  });
  const gstin = await decryptField(row.client.gstinEnc, {
    firmId,
    table: 'client',
    column: 'gstin_enc',
    rowId: row.client.id,
  });
  const udyam = await decryptField(row.client.udyamEnc, {
    firmId,
    table: 'client',
    column: 'udyam_enc',
    rowId: row.client.id,
  });

  const ownershipValues = row.client.promoters
    .map((p) => (p.ownershipPercent ? Number(p.ownershipPercent) : null))
    .filter((n): n is number => n !== null);

  const today = new Date().toISOString().slice(0, 10);
  const activeConsent = row.consents.some(
    (c) => !c.validUntil || dateStr(c.validUntil)! >= today,
  );

  const mandatoryOutstanding = row.documents.filter(
    (d) => d.isRequired && d.status === 'REQUIRED',
  ).length;

  // Is this loan account already recorded on another case in this firm?
  let duplicateLoan = false;
  if (row.loan?.loanAccountBlindIndex) {
    const other = await db().loan.findFirst({
      where: {
        loanAccountBlindIndex: row.loan.loanAccountBlindIndex,
        NOT: { caseId },
      },
      select: { id: true },
    });
    duplicateLoan = Boolean(other);
  }

  const embeddedPan = gstin ? panFromGstin(gstin) : null;
  const entityType = row.client.entityType as EntityType;
  const panFourth = pan?.[3];
  const panEntityCharMatches =
    !pan || !panFourth
      ? true
      : (PAN_FOURTH_CHAR_BY_ENTITY[entityType] ?? []).includes(panFourth);

  return {
    'case.applicationDate': dateStr(row.applicationDate),
    'case.applicationType': row.applicationType,
    'case.status': row.status,
    'case.hasDuplicateLoanAccount': duplicateLoan,

    'client.legalName': row.client.legalName,
    'client.entityType': row.client.entityType,
    'client.pan': pan,
    'client.gstin': gstin,
    'client.udyam': udyam,
    'client.gstinValid': gstin ? gstinChecksumValid(gstin) : false,
    'client.gstinEmbeddedPan': embeddedPan,
    'client.panEntityCharMatches': panEntityCharMatches,
    'client.incorporationDate': dateStr(row.client.incorporationDate),

    'promoter.count': row.client.promoters.length,
    'promoter.primaryExists': row.client.promoters.some((p) => p.isPrimary),
    'promoter.ownershipSum': ownershipValues.length
      ? ownershipValues.reduce((a, b) => a + b, 0)
      : null,

    'project.projectName': row.project?.projectName ?? null,
    'project.districtCode': row.project?.districtCode ?? null,
    'project.talukaCode': row.project?.talukaCode ?? null,
    'project.dicCode': row.project?.dicCode ?? null,
    'project.commercialProductionDate': dateStr(row.project?.commercialProductionDate),
    'project.isExpansion': row.project?.isExpansion ?? false,

    'loan.bankId': row.loan?.bankId ?? null,
    'loan.sanctionDate': dateStr(row.loan?.sanctionDate),
    'loan.firstDisbursementDate': dateStr(row.loan?.firstDisbursementDate),
    'loan.lastDisbursementDate': dateStr(row.loan?.lastDisbursementDate),
    'loan.sanctionedAmount': decimal(row.loan?.sanctionedAmount),
    'loan.disbursedAmount': decimal(row.loan?.disbursedAmount),
    'loan.isTermLoan': row.loan?.isTermLoan ?? null,
    'loan.loanAccountNo': row.loan?.loanAccountLast4 ? 'present' : null,

    'employment.totalEmployees': row.employment?.totalEmployees ?? null,
    'employment.epfRegisteredEmployees': row.employment?.epfRegisteredEmployees ?? null,
    'employment.localEmployees': row.employment?.localEmployees ?? null,
    'employment.epfEstablishmentCode': row.employment?.epfEstablishmentCode ?? null,

    'investment.landCost': decimal(row.investment?.landCost),
    'investment.landDevelopmentCost': decimal(row.investment?.landDevelopmentCost),
    'investment.buildingCost': decimal(row.investment?.buildingCost),
    'investment.plantMachineryCost': decimal(row.investment?.plantMachineryCost),
    'investment.electricalInstallationCost': decimal(row.investment?.electricalInstallationCost),
    'investment.equipmentCost': decimal(row.investment?.equipmentCost),
    'investment.furnitureFixtureCost': decimal(row.investment?.furnitureFixtureCost),
    'investment.otherEligibleCost': decimal(row.investment?.otherEligibleCost),
    'investment.preOperativeExpenses': decimal(row.investment?.preOperativeExpenses),
    'investment.totalProjectCost': decimal(row.investment?.totalProjectCost),
    'investment.eligibleInvestmentTotal': decimal(row.investment?.eligibleInvestmentTotal),
    'investment.promoterContribution': decimal(row.investment?.promoterContribution),
    'investment.termLoanComponent': decimal(row.investment?.termLoanComponent),
    'investment.workingCapitalComponent': decimal(row.investment?.workingCapitalComponent),
    'investment.otherSourceAmount': decimal(row.investment?.otherSourceAmount),
    'investment.subsidyClaimedAmount': decimal(row.investment?.subsidyClaimedAmount),

    'firstSale.firstSaleDate': dateStr(row.firstSale?.firstSaleDate),
    'firstSale.invoiceNumber': row.firstSale?.invoiceNumber ?? null,
    'firstSale.invoiceDate': dateStr(row.firstSale?.invoiceDate),
    'firstSale.invoiceAmount': decimal(row.firstSale?.invoiceAmount),

    'documents.allMandatoryAccountedFor': mandatoryOutstanding === 0,
    'documents.outstandingMandatory': mandatoryOutstanding,
    'consent.active': activeConsent,

    _schemeVersionId: row.schemeVersionId,
  };
}

/* ----------------------------- rule loading ----------------------------- */

export async function loadActiveRuleset(schemeVersionId: string) {
  const today = new Date();
  // Catalog tables are global and read-only for the app role.
  const versions = await db().validationRuleVersion.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ schemeVersionId }, { schemeVersionId: null }],
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
      ],
      rule: { isActive: true },
    },
    include: { rule: { select: { code: true, name: true, category: true } } },
    orderBy: { id: 'asc' },
  });
  return versions;
}

export function rulesetHash(ids: string[]): string {
  return createHash('sha256').update(ids.sort().join('|')).digest('hex');
}

/* -------------------------------- run ---------------------------------- */

/** Readiness: 100 minus a weighted penalty. Blocking findings hurt most. */
function computeReadiness(blocking: number, warning: number): number {
  const score = 100 - blocking * 20 - warning * 5;
  return Math.max(0, Math.min(100, score));
}

export async function runValidation(
  caseId: string,
  firmId: string,
  userId: string,
  trigger: 'MANUAL' | 'ON_SAVE' | 'PRE_AUTOFILL' | 'SCHEDULED' = 'MANUAL',
): Promise<RunResult> {
  const startedAt = new Date();
  const values = await buildValueMap(caseId, firmId);
  const schemeVersionId = values._schemeVersionId as string;
  const ruleset = await loadActiveRuleset(schemeVersionId);
  const today = new Date().toISOString().slice(0, 10);

  const findings: FindingDraft[] = [];

  for (const version of ruleset) {
    try {
      const passed = evaluate(version.expression, {
        values,
        params: (version.params ?? {}) as Record<string, unknown>,
        today,
      });
      if (passed) continue;

      findings.push({
        ruleVersionId: version.id,
        ruleCode: version.rule.code,
        ruleName: version.rule.name,
        severity: version.severity,
        category: version.rule.category,
        message: version.messageTemplate,
        remediationHint: version.remediationHint,
        fieldCode: version.fieldCode,
        section: version.section,
        sourceReference: version.sourceReference,
      });
    } catch (err) {
      // A broken rule must not break the run. It is logged loudly instead.
      logger.error(
        { err, ruleCode: version.rule.code, ruleVersionId: version.id },
        err instanceof RuleEvaluationError ? 'rule evaluation failed' : 'unexpected rule error',
      );
    }
  }

  const blockingCount = findings.filter((f) => f.severity === 'BLOCKING').length;
  const warningCount = findings.filter((f) => f.severity === 'WARNING').length;
  const infoCount = findings.filter((f) => f.severity === 'INFO').length;
  const readinessScore = computeReadiness(blockingCount, warningCount);
  const hash = rulesetHash(ruleset.map((r) => r.id));

  const runId = uuidv7();
  await db().caseValidationRun.create({
    data: {
      id: runId,
      firmId,
      caseId,
      trigger,
      startedAt,
      finishedAt: new Date(),
      blockingCount,
      warningCount,
      infoCount,
      readinessScore,
      rulesetHash: hash,
      triggeredByUserId: userId,
      findings: {
        create: findings.map((f) => ({
          id: uuidv7(),
          firmId,
          ruleVersionId: f.ruleVersionId,
          severity: f.severity,
          message: f.message,
          fieldCode: f.fieldCode,
          section: f.section,
          status: 'OPEN',
        })),
      },
    },
  });

  await db().case.update({
    where: { id: caseId },
    data: { readinessScore, lastValidationRunId: runId },
  });

  return { runId, blockingCount, warningCount, infoCount, readinessScore, rulesetHash: hash, findings };
}

/** Are there open BLOCKING findings? Used as a transition precondition. */
export async function hasOpenBlockingFindings(caseId: string): Promise<boolean> {
  const latest = await db().caseValidationRun.findFirst({
    where: { caseId },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  if (!latest) return true; // never validated — treat as not ready

  const count = await db().caseValidationFinding.count({
    where: { runId: latest.id, severity: 'BLOCKING', status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
  });
  return count > 0;
}
