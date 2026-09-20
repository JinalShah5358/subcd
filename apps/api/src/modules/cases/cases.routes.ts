import { Router } from 'express';
import { Prisma } from '@prisma/client';
import {
  CASE_STATUS_LABEL,
  canTransition,
  caseCreateSchema,
  caseSearchSchema,
  caseStatusChangeSchema,
  caseUpdateSchema,
  documentSlotUpdateSchema,
  employmentSchema,
  firstSaleSchema,
  investmentSchema,
  isLocked,
  loanSchema,
  projectSchema,
  uuidv7,
  type CaseCreateInput,
  type CaseSearchInput,
  type CaseStatusChangeInput,
  type CaseUpdateInput,
  type DocumentSlotUpdateInput,
  type EmploymentInput,
  type FirstSaleInput,
  type InvestmentInput,
  type LoanInput,
  type ProjectInput,
} from '@ifp/shared';
import { db, getAuth } from '../../auth/context';
import { authenticate, authorize, handler, rateLimits, valid, validate } from '../../middleware';
import { assertQuota, enforceLicense } from '../../services/license/license';
import { writeAudit } from '../../services/audit/auditWriter';
import { sealIdentifier, maskedFromLast4 } from '../../services/crypto';
import { hasOpenBlockingFindings, runValidation } from '../../services/validation/engine';
import { pageSlice, toPage } from '../../utils/pagination';
import { badRequest, conflict, notFound, preconditionFailed } from '../../utils/problem';

export const casesRouter = Router();
casesRouter.use(authenticate());
casesRouter.use(enforceLicense());

const dateStr = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;
const dec = (d: Prisma.Decimal | null | undefined) => (d ? d.toString() : null);
const toDate = (s: string | null | undefined) => (s ? new Date(s) : null);
const toDec = (s: string | null | undefined) => (s ? new Prisma.Decimal(s) : null);

/* --------------------------- case number ----------------------------- */

async function nextCaseNumber(firmId: string): Promise<string> {
  const firm = await db().client.findFirst({ where: {}, select: { id: true } });
  void firm;
  const year = new Date().getFullYear();
  const prefix = `IFP-${year}-`;

  const last = await db().case.findFirst({
    where: { caseNumber: { startsWith: prefix } },
    orderBy: { caseNumber: 'desc' },
    select: { caseNumber: true },
  });

  const lastSeq = last ? Number(last.caseNumber.slice(prefix.length)) : 0;
  const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

/* ------------------------------- list -------------------------------- */

casesRouter.get(
  '/',
  authorize('case:read'),
  rateLimits.read,
  validate(caseSearchSchema, 'query'),
  handler(async (req, res) => {
    const q = valid<CaseSearchInput>(req, 'query');

    const where: Prisma.CaseWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.assignedToUserId ? { assignedToUserId: q.assignedToUserId } : {}),
      ...(q.applicationType ? { applicationType: q.applicationType } : {}),
      ...(q.q
        ? {
            OR: [
              { caseNumber: { contains: q.q, mode: 'insensitive' } },
              { title: { contains: q.q, mode: 'insensitive' } },
              { client: { legalName: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.CaseOrderByWithRelationInput =
      q.sort === 'caseNumber'
        ? { caseNumber: q.dir }
        : q.sort === 'readinessScore'
          ? { readinessScore: q.dir }
          : q.sort === 'status'
            ? { status: q.dir }
            : { updatedAt: q.dir };

    const listSelect = {
      id: true,
      caseNumber: true,
      title: true,
      applicationType: true,
      status: true,
      readinessScore: true,
      applicationDate: true,
      updatedAt: true,
      client: { select: { id: true, legalName: true } },
      assignedTo: { select: { id: true, fullName: true } },
    } satisfies Prisma.CaseSelect;

    const [rows, total] = await Promise.all([
      db().case.findMany({ where, select: listSelect, orderBy, ...pageSlice(q) }),
      db().case.count({ where }),
    ]);

    res.json(
      toPage(
        rows.map((c) => ({
          ...c,
          applicationDate: dateStr(c.applicationDate),
          updatedAt: c.updatedAt.toISOString(),
          statusLabel: CASE_STATUS_LABEL[c.status],
        })),
        total,
        q,
      ),
    );
  }),
);

/* ------------------------------ create ------------------------------- */

casesRouter.post(
  '/',
  authorize('case:write'),
  rateLimits.write,
  validate(caseCreateSchema),
  handler(async (req, res) => {
    const body = valid<CaseCreateInput>(req);
    const { firmId, userId } = getAuth();

    const client = await db().client.findFirst({
      where: { id: body.clientId, deletedAt: null },
      select: { id: true, legalName: true },
    });
    if (!client) throw notFound('That client');

    // Soft duplicate guard: same client + scheme + type already in flight.
    const existing = await db().case.findFirst({
      where: {
        clientId: body.clientId,
        schemeVersionId: body.schemeVersionId,
        applicationType: body.applicationType,
        deletedAt: null,
        status: { notIn: ['WITHDRAWN', 'REJECTED', 'ARCHIVED'] },
      },
      select: { id: true, caseNumber: true },
    });
    if (existing && !body.duplicateOverrideReason) {
      throw conflict(
        `${client.legalName} already has an open ${body.applicationType.toLowerCase().replace(/_/g, ' ')} case`,
        `Case ${existing.caseNumber} is still open. Supply a reason to create another one anyway.`,
        existing.id,
      );
    }

    await assertQuota(firmId, 'cases');

    // Checklist is snapshotted from the scheme version at creation time.
    const requirements = await db().schemeDocumentRequirement.findMany({
      where: { schemeVersionId: body.schemeVersionId },
      select: { documentTypeId: true, isMandatory: true, sortOrder: true },
    });
    if (!requirements.length) {
      const schemeExists = await db().schemeVersion.findFirst({
        where: { id: body.schemeVersionId },
        select: { id: true },
      });
      if (!schemeExists) throw notFound('That scheme version');
    }

    const id = uuidv7();
    let caseNumber = await nextCaseNumber(firmId);

    const create = async (num: string) =>
      db().case.create({
        data: {
          id,
          firmId,
          clientId: body.clientId,
          schemeVersionId: body.schemeVersionId,
          caseNumber: num,
          title: body.title ?? `${client.legalName} — ${body.applicationType.replace(/_/g, ' ').toLowerCase()}`,
          applicationType: body.applicationType,
          status: 'DRAFT',
          assignedToUserId: body.assignedToUserId ?? userId,
          duplicateOverrideReason: body.duplicateOverrideReason ?? null,
          createdById: userId,
          documents: {
            create: requirements.map((r) => ({
              id: uuidv7(),
              firmId,
              documentTypeId: r.documentTypeId,
              isRequired: r.isMandatory,
              status: 'REQUIRED',
              sortOrder: r.sortOrder,
            })),
          },
        },
        select: { id: true, caseNumber: true, status: true, title: true },
      });

    let created;
    try {
      created = await create(caseNumber);
    } catch (err) {
      // Two users creating a case in the same second — retry once with a fresh number.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        caseNumber = await nextCaseNumber(firmId);
        created = await create(caseNumber);
      } else {
        throw err;
      }
    }

    await writeAudit({
      action: 'CASE_CREATED',
      entityType: 'case',
      entityId: id,
      metadata: { caseNumber: created.caseNumber, clientName: client.legalName },
    });

    res.status(201).json(created);
  }),
);

/* ------------------------------- read -------------------------------- */

async function loadCaseOrThrow(id: string) {
  const row = await db().case.findFirst({
    where: { id, deletedAt: null },
    include: {
      client: {
        select: { id: true, legalName: true, entityType: true, panLast4: true, gstinLast4: true },
      },
      schemeVersion: {
        select: {
          id: true,
          versionLabel: true,
          status: true,
          scheme: { select: { code: true, name: true } },
        },
      },
      assignedTo: { select: { id: true, fullName: true } },
      project: true,
      loan: { include: { bank: { select: { id: true, name: true, branchName: true, ifsc: true } } } },
      employment: true,
      investment: true,
      firstSale: true,
      documents: {
        include: { documentType: { select: { id: true, code: true, name: true, category: true } } },
        orderBy: { sortOrder: 'asc' },
      },
      consents: {
        where: { status: 'RECORDED' },
        select: { id: true, recordedAt: true, method: true, validUntil: true },
        orderBy: { recordedAt: 'desc' },
        take: 1,
      },
    },
  });
  if (!row) throw notFound('That case');
  return row;
}

casesRouter.get(
  '/:id',
  authorize('case:read'),
  rateLimits.read,
  handler(async (req, res) => {
    const row = await loadCaseOrThrow(req.params.id!);

    await writeAudit({
      action: 'SENSITIVE_DATA_VIEWED',
      entityType: 'case',
      entityId: row.id,
      metadata: { caseNumber: row.caseNumber },
    });

    res.json({
      id: row.id,
      caseNumber: row.caseNumber,
      title: row.title,
      applicationType: row.applicationType,
      status: row.status,
      statusLabel: CASE_STATUS_LABEL[row.status],
      statusReason: row.statusReason,
      applicationDate: dateStr(row.applicationDate),
      portalApplicationNo: row.portalApplicationNo,
      filedAt: row.filedAt?.toISOString() ?? null,
      readinessScore: row.readinessScore,
      locked: isLocked(row.status),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      client: {
        ...row.client,
        panMasked: maskedFromLast4(row.client.panLast4),
        gstinMasked: maskedFromLast4(row.client.gstinLast4, 15),
      },
      schemeVersion: row.schemeVersion,
      assignedTo: row.assignedTo,
      project: row.project
        ? {
            ...row.project,
            commercialProductionDate: dateStr(row.project.commercialProductionDate),
            latitude: dec(row.project.latitude),
            longitude: dec(row.project.longitude),
            createdAt: undefined,
            updatedAt: undefined,
          }
        : null,
      loan: row.loan
        ? {
            ...row.loan,
            loanAccountMasked: maskedFromLast4(row.loan.loanAccountLast4, 12),
            loanAccountEnc: undefined,
            loanAccountBlindIndex: undefined,
            sanctionDate: dateStr(row.loan.sanctionDate),
            firstDisbursementDate: dateStr(row.loan.firstDisbursementDate),
            lastDisbursementDate: dateStr(row.loan.lastDisbursementDate),
            sanctionedAmount: dec(row.loan.sanctionedAmount),
            disbursedAmount: dec(row.loan.disbursedAmount),
            interestRatePercent: dec(row.loan.interestRatePercent),
            createdAt: undefined,
            updatedAt: undefined,
          }
        : null,
      employment: row.employment
        ? { ...row.employment, asOnDate: dateStr(row.employment.asOnDate), createdAt: undefined, updatedAt: undefined }
        : null,
      investment: row.investment
        ? Object.fromEntries(
            Object.entries(row.investment).map(([k, v]) => [
              k,
              v instanceof Prisma.Decimal ? v.toString() : v instanceof Date ? undefined : v,
            ]),
          )
        : null,
      firstSale: row.firstSale
        ? {
            ...row.firstSale,
            buyerGstinEnc: undefined,
            buyerGstinMasked: maskedFromLast4(row.firstSale.buyerGstinLast4, 15),
            firstSaleDate: dateStr(row.firstSale.firstSaleDate),
            invoiceDate: dateStr(row.firstSale.invoiceDate),
            commercialProductionDate: dateStr(row.firstSale.commercialProductionDate),
            invoiceAmount: dec(row.firstSale.invoiceAmount),
            quantity: dec(row.firstSale.quantity),
            createdAt: undefined,
            updatedAt: undefined,
          }
        : null,
      documents: row.documents.map((d) => ({
        id: d.id,
        documentTypeId: d.documentTypeId,
        code: d.documentType.code,
        name: d.documentType.name,
        category: d.documentType.category,
        isRequired: d.isRequired,
        status: d.status,
        verificationStatus: d.verificationStatus,
        notes: d.notes,
      })),
      consent: row.consents[0]
        ? {
            id: row.consents[0].id,
            recordedAt: row.consents[0].recordedAt.toISOString(),
            method: row.consents[0].method,
            validUntil: dateStr(row.consents[0].validUntil),
          }
        : null,
    });
  }),
);

/* ------------------------------ update ------------------------------- */

async function assertEditable(id: string) {
  const row = await db().case.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, caseNumber: true },
  });
  if (!row) throw notFound('That case');
  if (isLocked(row.status)) {
    throw preconditionFailed(
      `Case ${row.caseNumber} is ${CASE_STATUS_LABEL[row.status].toLowerCase()} and cannot be edited`,
      'Move it back to review first if a correction is genuinely needed.',
    );
  }
  return row;
}

casesRouter.patch(
  '/:id',
  authorize('case:write'),
  rateLimits.write,
  validate(caseUpdateSchema),
  handler(async (req, res) => {
    const id = req.params.id!;
    const body = valid<CaseUpdateInput>(req);
    await assertEditable(id);

    const data: Prisma.CaseUncheckedUpdateInput = {};
    if ('title' in body) data.title = body.title ?? null;
    if ('applicationDate' in body) data.applicationDate = toDate(body.applicationDate);
    if ('assignedToUserId' in body) data.assignedToUserId = body.assignedToUserId ?? null;

    const updated = await db().case.update({
      where: { id },
      data,
      select: { id: true, caseNumber: true, title: true, applicationDate: true },
    });

    await writeAudit({
      action: 'CASE_UPDATED',
      entityType: 'case',
      entityId: id,
      changedFields: Object.keys(data),
      metadata: { caseNumber: updated.caseNumber },
    });

    res.json({ ...updated, applicationDate: dateStr(updated.applicationDate) });
  }),
);

/* ---------------------------- status change --------------------------- */

casesRouter.post(
  '/:id/status',
  authorize('case:transition'),
  rateLimits.write,
  validate(caseStatusChangeSchema),
  handler(async (req, res) => {
    const id = req.params.id!;
    const body = valid<CaseStatusChangeInput>(req);
    const { userId } = getAuth();

    const row = await db().case.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, caseNumber: true },
    });
    if (!row) throw notFound('That case');

    if (row.status === body.status) {
      throw badRequest(`This case is already ${CASE_STATUS_LABEL[body.status].toLowerCase()}`);
    }
    if (!canTransition(row.status, body.status)) {
      throw preconditionFailed(
        `A case cannot go from ${CASE_STATUS_LABEL[row.status].toLowerCase()} to ${CASE_STATUS_LABEL[body.status].toLowerCase()}`,
      );
    }

    // ---- server-enforced preconditions ----
    if (body.status === 'IN_REVIEW' || body.status === 'READY_TO_FILE') {
      if (await hasOpenBlockingFindings(id)) {
        throw preconditionFailed(
          'This case still has blocking validation findings',
          'Run validation and resolve every blocking finding first.',
        );
      }
    }

    if (body.status === 'READY_TO_FILE') {
      const outstanding = await db().caseDocument.count({
        where: { caseId: id, isRequired: true, status: 'REQUIRED' },
      });
      if (outstanding > 0) {
        throw preconditionFailed(
          `${outstanding} mandatory document${outstanding === 1 ? '' : 's'} not accounted for`,
          'Mark each as present, not available, or not applicable on the checklist.',
        );
      }

      const consent = await db().consentRecord.count({
        where: { caseId: id, status: 'RECORDED' },
      });
      if (consent === 0) {
        throw preconditionFailed(
          'No client authorization has been recorded',
          'Complete the consent step before marking the case ready to file.',
        );
      }
    }

    if (body.status === 'FILED' && !body.portalApplicationNo) {
      throw preconditionFailed(
        'Record the portal application number',
        'This platform never submits on your behalf — enter the number the portal gave you after you submitted.',
      );
    }

    const data: Prisma.CaseUncheckedUpdateInput = {
      status: body.status,
      statusReason: body.reason ?? null,
    };
    if (body.status === 'FILED') {
      data.portalApplicationNo = body.portalApplicationNo ?? null;
      data.filedAt = body.filedAt ? new Date(body.filedAt) : new Date();
      data.filedByUserId = userId;
    }

    await db().case.update({ where: { id }, data });

    await writeAudit({
      action: 'CASE_STATUS_CHANGED',
      entityType: 'case',
      entityId: id,
      metadata: {
        caseNumber: row.caseNumber,
        fromStatus: row.status,
        toStatus: body.status,
        ...(body.reason ? { reason: body.reason } : {}),
      },
    });

    res.json({ id, status: body.status, statusLabel: CASE_STATUS_LABEL[body.status] });
  }),
);

/* ------------------------------ delete -------------------------------- */

casesRouter.delete(
  '/:id',
  authorize('case:write'),
  rateLimits.write,
  handler(async (req, res) => {
    const id = req.params.id!;
    const row = await db().case.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, caseNumber: true },
    });
    if (!row) throw notFound('That case');
    if (isLocked(row.status)) {
      throw preconditionFailed('A filed or approved case cannot be deleted');
    }

    await db().case.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit({
      action: 'CASE_DELETED',
      entityType: 'case',
      entityId: id,
      metadata: { caseNumber: row.caseNumber },
    });
    res.status(204).send();
  }),
);

/* ----------------------------- sections ------------------------------- */

/** Every section is an idempotent upsert; partial drafts always save. */
function sectionRoute<T>(
  path: 'project' | 'employment' | 'investment' | 'firstSale',
  schema: Parameters<typeof validate>[0],
  build: (input: T) => Record<string, unknown>,
) {
  casesRouter.put(
    `/:id/${path === 'firstSale' ? 'first-sale' : path}`,
    authorize('case:write'),
    rateLimits.write,
    validate(schema),
    handler(async (req, res) => {
      const caseId = req.params.id!;
      const { firmId } = getAuth();
      const row = await assertEditable(caseId);
      const input = valid<T>(req);
      const data = build(input);

      const delegate = db()[path] as unknown as {
        upsert: (args: unknown) => Promise<{ id: string }>;
      };

      const saved = await delegate.upsert({
        where: { caseId },
        create: { id: uuidv7(), firmId, caseId, ...data },
        update: data,
      });

      await writeAudit({
        action: 'CASE_SECTION_UPDATED',
        entityType: 'case',
        entityId: caseId,
        changedFields: Object.keys(data),
        metadata: { caseNumber: row.caseNumber, section: path },
      });

      res.json({ id: saved.id, section: path });
    }),
  );
}

sectionRoute<ProjectInput>('project', projectSchema, (i) => ({
  projectName: i.projectName ?? null,
  addressLine1: i.addressLine1 ?? null,
  addressLine2: i.addressLine2 ?? null,
  village: i.village ?? null,
  talukaCode: i.talukaCode ?? null,
  districtCode: i.districtCode ?? null,
  dicCode: i.dicCode ?? null,
  pincode: i.pincode ?? null,
  gidcEstate: i.gidcEstate ?? null,
  plotSurveyNo: i.plotSurveyNo ?? null,
  areaType: i.areaType ?? null,
  isExpansion: i.isExpansion ?? false,
  commercialProductionDate: toDate(i.commercialProductionDate),
  latitude: toDec(i.latitude),
  longitude: toDec(i.longitude),
}));

sectionRoute<EmploymentInput>('employment', employmentSchema, (i) => ({
  epfEstablishmentCode: i.epfEstablishmentCode ?? null,
  esicCode: i.esicCode ?? null,
  totalEmployees: i.totalEmployees ?? null,
  epfRegisteredEmployees: i.epfRegisteredEmployees ?? null,
  localEmployees: i.localEmployees ?? null,
  skilledCount: i.skilledCount ?? null,
  semiSkilledCount: i.semiSkilledCount ?? null,
  unskilledCount: i.unskilledCount ?? null,
  maleCount: i.maleCount ?? null,
  femaleCount: i.femaleCount ?? null,
  differentlyAbledCount: i.differentlyAbledCount ?? null,
  contractEmployees: i.contractEmployees ?? null,
  employmentGeneratedNew: i.employmentGeneratedNew ?? null,
  asOnDate: toDate(i.asOnDate),
}));

sectionRoute<InvestmentInput>('investment', investmentSchema, (i) => ({
  landCost: toDec(i.landCost),
  landDevelopmentCost: toDec(i.landDevelopmentCost),
  buildingCost: toDec(i.buildingCost),
  plantMachineryCost: toDec(i.plantMachineryCost),
  electricalInstallationCost: toDec(i.electricalInstallationCost),
  equipmentCost: toDec(i.equipmentCost),
  furnitureFixtureCost: toDec(i.furnitureFixtureCost),
  otherEligibleCost: toDec(i.otherEligibleCost),
  preOperativeExpenses: toDec(i.preOperativeExpenses),
  totalProjectCost: toDec(i.totalProjectCost),
  eligibleInvestmentTotal: toDec(i.eligibleInvestmentTotal),
  promoterContribution: toDec(i.promoterContribution),
  termLoanComponent: toDec(i.termLoanComponent),
  workingCapitalComponent: toDec(i.workingCapitalComponent),
  otherSourceAmount: toDec(i.otherSourceAmount),
  subsidyClaimedAmount: toDec(i.subsidyClaimedAmount),
  isSecondHandMachinery: i.isSecondHandMachinery ?? false,
  machineryInvoiceCount: i.machineryInvoiceCount ?? null,
  valuationBasis: i.valuationBasis ?? null,
}));

sectionRoute<FirstSaleInput>('firstSale', firstSaleSchema, (i) => ({
  firstSaleDate: toDate(i.firstSaleDate),
  invoiceNumber: i.invoiceNumber ?? null,
  invoiceDate: toDate(i.invoiceDate),
  invoiceAmount: toDec(i.invoiceAmount),
  buyerName: i.buyerName ?? null,
  buyerGstinLast4: i.buyerGstin ? i.buyerGstin.slice(-4) : null,
  productDescription: i.productDescription ?? null,
  quantity: toDec(i.quantity),
  uom: i.uom ?? null,
  eWayBillNo: i.eWayBillNo ?? null,
  commercialProductionDate: toDate(i.commercialProductionDate),
}));

/** Loan is special: it may create a bank row and it seals the account number. */
casesRouter.put(
  '/:id/loan',
  authorize('case:write'),
  rateLimits.write,
  validate(loanSchema),
  handler(async (req, res) => {
    const caseId = req.params.id!;
    const body = valid<LoanInput>(req);
    const { firmId } = getAuth();
    const row = await assertEditable(caseId);

    let bankId = body.bankId ?? null;
    if (!bankId && body.newBank) {
      const bank = await db().bank.create({
        data: {
          id: uuidv7(),
          firmId,
          name: body.newBank.name,
          branchName: body.newBank.branchName,
          ifsc: body.newBank.ifsc ?? null,
          bankType: body.newBank.bankType ?? null,
        },
        select: { id: true },
      });
      bankId = bank.id;
    }

    const existing = await db().loan.findFirst({ where: { caseId }, select: { id: true } });
    const loanId = existing?.id ?? uuidv7();

    const sealed = await sealIdentifier(body.loanAccountNo ?? null, {
      firmId,
      table: 'loan',
      column: 'loan_account_enc',
      rowId: loanId,
      field: 'loan.account',
    });

    const data = {
      bankId,
      loanAccountEnc: sealed.enc,
      loanAccountLast4: sealed.last4,
      loanAccountBlindIndex: sealed.blindIndex,
      sanctionLetterRef: body.sanctionLetterRef ?? null,
      sanctionDate: toDate(body.sanctionDate),
      firstDisbursementDate: toDate(body.firstDisbursementDate),
      lastDisbursementDate: toDate(body.lastDisbursementDate),
      sanctionedAmount: toDec(body.sanctionedAmount),
      disbursedAmount: toDec(body.disbursedAmount),
      interestRatePercent: toDec(body.interestRatePercent),
      rateType: body.rateType ?? null,
      tenureMonths: body.tenureMonths ?? null,
      moratoriumMonths: body.moratoriumMonths ?? null,
      purpose: body.purpose ?? null,
      isTermLoan: body.isTermLoan ?? true,
    };

    await db().loan.upsert({
      where: { caseId },
      create: { id: loanId, firmId, caseId, ...data },
      update: data,
    });

    await writeAudit({
      action: 'CASE_SECTION_UPDATED',
      entityType: 'case',
      entityId: caseId,
      changedFields: Object.keys(data),
      metadata: { caseNumber: row.caseNumber, section: 'loan' },
    });

    res.json({ id: loanId, section: 'loan' });
  }),
);

/* ---------------------------- documents ------------------------------- */

casesRouter.get(
  '/:id/documents',
  authorize('document:read'),
  rateLimits.read,
  handler(async (req, res) => {
    const caseId = req.params.id!;
    const exists = await db().case.findFirst({ where: { id: caseId, deletedAt: null }, select: { id: true } });
    if (!exists) throw notFound('That case');

    const rows = await db().caseDocument.findMany({
      where: { caseId },
      include: { documentType: { select: { code: true, name: true, description: true, category: true } } },
      orderBy: { sortOrder: 'asc' },
    });

    res.json(
      rows.map((d) => ({
        id: d.id,
        code: d.documentType.code,
        name: d.documentType.name,
        description: d.documentType.description,
        category: d.documentType.category,
        isRequired: d.isRequired,
        status: d.status,
        verificationStatus: d.verificationStatus,
        notes: d.notes,
        verifiedAt: d.verifiedAt?.toISOString() ?? null,
      })),
    );
  }),
);

casesRouter.patch(
  '/:id/documents/:slotId',
  authorize('document:write'),
  rateLimits.write,
  validate(documentSlotUpdateSchema),
  handler(async (req, res) => {
    const caseId = req.params.id!;
    const slotId = req.params.slotId!;
    const body = valid<DocumentSlotUpdateInput>(req);
    const { userId } = getAuth();

    const slot = await db().caseDocument.findFirst({
      where: { id: slotId, caseId },
      include: { documentType: { select: { code: true } } },
    });
    if (!slot) throw notFound('That checklist item');

    const data: Prisma.CaseDocumentUncheckedUpdateInput = {
      status: body.status,
      notes: body.notes ?? null,
    };
    if (body.verificationStatus) {
      data.verificationStatus = body.verificationStatus;
      data.verifiedByUserId = body.verificationStatus === 'VERIFIED' ? userId : null;
      data.verifiedAt = body.verificationStatus === 'VERIFIED' ? new Date() : null;
    }

    const updated = await db().caseDocument.update({
      where: { id: slotId },
      data,
      select: { id: true, status: true, verificationStatus: true, notes: true },
    });

    await writeAudit({
      action: 'DOCUMENT_SLOT_UPDATED',
      entityType: 'case_document',
      entityId: slotId,
      changedFields: Object.keys(data),
      metadata: { documentTypeCode: slot.documentType.code, slotStatus: body.status },
    });

    res.json(updated);
  }),
);

/* --------------------------- validation ------------------------------- */

casesRouter.post(
  '/:id/validate',
  authorize('validation:run'),
  rateLimits.write,
  handler(async (req, res) => {
    const caseId = req.params.id!;
    const { firmId, userId } = getAuth();

    const exists = await db().case.findFirst({
      where: { id: caseId, deletedAt: null },
      select: { id: true, caseNumber: true },
    });
    if (!exists) throw notFound('That case');

    const result = await runValidation(caseId, firmId, userId, 'MANUAL');

    await writeAudit({
      action: 'VALIDATION_RUN',
      entityType: 'case',
      entityId: caseId,
      metadata: {
        caseNumber: exists.caseNumber,
        blockingCount: result.blockingCount,
        warningCount: result.warningCount,
        readinessScore: result.readinessScore,
        trigger: 'MANUAL',
      },
    });

    res.json(result);
  }),
);
