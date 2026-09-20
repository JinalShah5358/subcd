import { Router } from 'express';
import { Prisma } from '@prisma/client';
import {
  clientCreateSchema,
  clientSearchSchema,
  clientUpdateSchema,
  duplicateCheckSchema,
  promoterCreateSchema,
  promoterUpdateSchema,
  revealFieldSchema,
  uuidv7,
  type ClientCreateInput,
  type ClientSearchInput,
  type ClientUpdateInput,
  type DuplicateCheckInput,
  type PromoterCreateInput,
  type PromoterUpdateInput,
  type RevealFieldInput,
} from '@ifp/shared';
import { db, getAuth } from '../../auth/context';
import { authenticate, authorize, handler, rateLimits, valid, validate } from '../../middleware';
import { assertQuota, enforceLicense } from '../../services/license/license';
import {
  blindIndex,
  decryptField,
  maskedFromLast4,
  sealIdentifier,
} from '../../services/crypto';
import { changedFieldNames, writeAudit } from '../../services/audit/auditWriter';
import { pageSlice, toPage } from '../../utils/pagination';
import { badRequest, conflict, duplicateClient, notFound } from '../../utils/problem';

export const clientsRouter = Router();
clientsRouter.use(authenticate());
clientsRouter.use(enforceLicense());

/* ------------------------------ helpers ------------------------------- */

type ClientRow = Prisma.ClientGetPayload<{
  select: {
    id: true;
    legalName: true;
    tradeName: true;
    entityType: true;
    panLast4: true;
    gstinLast4: true;
    udyamLast4: true;
    contactPersonName: true;
    contactEmail: true;
    contactPhone: true;
    createdAt: true;
    deletedAt: true;
  };
}>;

const LIST_SELECT = {
  id: true,
  legalName: true,
  tradeName: true,
  entityType: true,
  panLast4: true,
  gstinLast4: true,
  udyamLast4: true,
  contactPersonName: true,
  contactEmail: true,
  contactPhone: true,
  createdAt: true,
  deletedAt: true,
} as const;

/** Identifiers leave the API masked. Full values require the reveal endpoint. */
function toSummary(row: ClientRow) {
  return {
    id: row.id,
    legalName: row.legalName,
    tradeName: row.tradeName,
    entityType: row.entityType,
    panMasked: maskedFromLast4(row.panLast4),
    gstinMasked: maskedFromLast4(row.gstinLast4, 15),
    udyamMasked: maskedFromLast4(row.udyamLast4, 19),
    contactPersonName: row.contactPersonName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

/** Maps a validated payload onto column values, sealing identifiers as it goes. */
async function buildClientData(
  input: Partial<ClientCreateInput>,
  firmId: string,
  rowId: string,
): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};

  const copy = [
    'legalName',
    'tradeName',
    'entityType',
    'constitutionNote',
    'businessActivity',
    'nicCode',
    'regdAddressLine1',
    'regdAddressLine2',
    'regdCity',
    'regdDistrictCode',
    'regdPincode',
    'contactPersonName',
    'contactEmail',
    'contactPhone',
    'notes',
  ] as const;

  for (const key of copy) {
    if (key in input) data[key] = (input as Record<string, unknown>)[key];
  }

  if ('incorporationDate' in input) {
    data.incorporationDate = input.incorporationDate ? new Date(input.incorporationDate) : null;
  }

  if ('pan' in input) {
    const sealed = await sealIdentifier(input.pan ?? null, {
      firmId,
      table: 'client',
      column: 'pan_enc',
      rowId,
      field: 'client.pan',
    });
    data.panEnc = sealed.enc;
    data.panLast4 = sealed.last4;
    data.panBlindIndex = sealed.blindIndex;
  }

  if ('gstin' in input) {
    const sealed = await sealIdentifier(input.gstin ?? null, {
      firmId,
      table: 'client',
      column: 'gstin_enc',
      rowId,
      field: 'client.gstin',
    });
    data.gstinEnc = sealed.enc;
    data.gstinLast4 = sealed.last4;
    data.gstinBlindIndex = sealed.blindIndex;
  }

  if ('udyam' in input) {
    const sealed = await sealIdentifier(input.udyam ?? null, {
      firmId,
      table: 'client',
      column: 'udyam_enc',
      rowId,
      field: 'client.udyam',
    });
    data.udyamEnc = sealed.enc;
    data.udyamLast4 = sealed.last4;
  }

  return data;
}

async function findDuplicate(
  firmId: string,
  opts: { pan?: string | null; gstin?: string | null; excludeId?: string },
): Promise<{ id: string; legalName: string; on: 'PAN' | 'GSTIN' } | null> {
  const where: Prisma.ClientWhereInput[] = [];
  if (opts.pan) where.push({ panBlindIndex: blindIndex(opts.pan, firmId, 'client.pan') });
  if (opts.gstin) where.push({ gstinBlindIndex: blindIndex(opts.gstin, firmId, 'client.gstin') });
  if (!where.length) return null;

  const match = await db().client.findFirst({
    where: {
      OR: where,
      deletedAt: null,
      ...(opts.excludeId ? { NOT: { id: opts.excludeId } } : {}),
    },
    select: { id: true, legalName: true, panBlindIndex: true },
  });
  if (!match) return null;

  const onPan =
    Boolean(opts.pan) &&
    match.panBlindIndex !== null &&
    Buffer.from(match.panBlindIndex).equals(blindIndex(opts.pan!, firmId, 'client.pan'));

  return { id: match.id, legalName: match.legalName, on: onPan ? 'PAN' : 'GSTIN' };
}

/* -------------------------------- list -------------------------------- */

clientsRouter.get(
  '/',
  authorize('client:read'),
  rateLimits.read,
  validate(clientSearchSchema, 'query'),
  handler(async (req, res) => {
    const q = valid<ClientSearchInput>(req, 'query');

    const where: Prisma.ClientWhereInput = {
      ...(q.includeDeleted ? {} : { deletedAt: null }),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.q
        ? {
            OR: [
              { legalName: { contains: q.q, mode: 'insensitive' } },
              { tradeName: { contains: q.q, mode: 'insensitive' } },
              { contactPersonName: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // `id` is a UUID v7, so it is monotonic by creation — sorting on it is the
    // same order as createdAt but uses the primary key index.
    const orderBy: Prisma.ClientOrderByWithRelationInput =
      q.sort === 'legalName'
        ? { legalName: q.dir }
        : q.sort === 'caseCount'
          ? { cases: { _count: q.dir } }
          : { id: q.dir };

    const [rows, total] = await Promise.all([
      db().client.findMany({
        where,
        select: { ...LIST_SELECT, _count: { select: { cases: true } } },
        orderBy,
        ...pageSlice(q),
      }),
      db().client.count({ where }),
    ]);

    res.json(
      toPage(
        rows.map((r) => ({ ...toSummary(r), caseCount: r._count.cases })),
        total,
        q,
      ),
    );
  }),
);

/* ----------------------------- duplicate ------------------------------ */

clientsRouter.post(
  '/check-duplicate',
  authorize('client:read'),
  rateLimits.read,
  validate(duplicateCheckSchema),
  handler(async (req, res) => {
    const body = valid<DuplicateCheckInput>(req);
    const { firmId } = getAuth();

    const match = await findDuplicate(firmId, {
      pan: body.pan ?? null,
      gstin: body.gstin ?? null,
      ...(body.excludeClientId ? { excludeId: body.excludeClientId } : {}),
    });

    // Returns existence + id only. Never echoes the submitted identifier back.
    res.json({
      duplicate: Boolean(match),
      clientId: match?.id ?? null,
      legalName: match?.legalName ?? null,
      matchedOn: match?.on ?? null,
    });
  }),
);

/* ------------------------------- create ------------------------------- */

clientsRouter.post(
  '/',
  authorize('client:write'),
  rateLimits.write,
  validate(clientCreateSchema),
  handler(async (req, res) => {
    const body = valid<ClientCreateInput>(req);
    const { firmId, userId } = getAuth();

    const dup = await findDuplicate(firmId, { pan: body.pan ?? null, gstin: body.gstin ?? null });
    if (dup) {
      throw duplicateClient(
        `${dup.legalName} is already on file with the same ${dup.on}`,
        dup.id,
        'Open the existing client instead of creating a second record.',
      );
    }

    // After the duplicate check, not before: if this client is already on file
    // the useful thing to say is "open that one", not "you are out of room".
    await assertQuota(firmId, 'clients');

    const id = uuidv7();
    const data = await buildClientData(body, firmId, id);

    const created = await db().client.create({
      data: {
        ...(data as Prisma.ClientUncheckedCreateInput),
        id,
        firmId,
        createdById: userId,
      },
      select: LIST_SELECT,
    });

    await writeAudit({
      action: 'CLIENT_CREATED',
      entityType: 'client',
      entityId: id,
      changedFields: Object.keys(data),
      metadata: { clientName: body.legalName },
    });

    res.status(201).json(toSummary(created));
  }),
);

/* -------------------------------- read -------------------------------- */

clientsRouter.get(
  '/:id',
  authorize('client:read'),
  rateLimits.read,
  handler(async (req, res) => {
    const id = req.params.id!;
    const row = await db().client.findFirst({
      where: { id },
      select: {
        ...LIST_SELECT,
        constitutionNote: true,
        businessActivity: true,
        nicCode: true,
        incorporationDate: true,
        regdAddressLine1: true,
        regdAddressLine2: true,
        regdCity: true,
        regdDistrictCode: true,
        regdPincode: true,
        notes: true,
        updatedAt: true,
        promoters: {
          select: {
            id: true,
            fullName: true,
            designation: true,
            ownershipPercent: true,
            panLast4: true,
            aadhaarLast4: true,
            email: true,
            phone: true,
            dateOfBirth: true,
            addressLine1: true,
            city: true,
            pincode: true,
            isPrimary: true,
          },
          orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }],
        },
        cases: {
          select: {
            id: true,
            caseNumber: true,
            status: true,
            applicationType: true,
            readinessScore: true,
            updatedAt: true,
          },
          where: { deletedAt: null },
          orderBy: { id: 'desc' },
          take: 25,
        },
      },
    });

    if (!row) throw notFound('That client');

    // Viewing a full client record is itself an auditable event.
    await writeAudit({
      action: 'SENSITIVE_DATA_VIEWED',
      entityType: 'client',
      entityId: id,
      metadata: { clientName: row.legalName },
    });

    res.json({
      ...toSummary(row),
      constitutionNote: row.constitutionNote,
      businessActivity: row.businessActivity,
      nicCode: row.nicCode,
      incorporationDate: row.incorporationDate?.toISOString().slice(0, 10) ?? null,
      regdAddressLine1: row.regdAddressLine1,
      regdAddressLine2: row.regdAddressLine2,
      regdCity: row.regdCity,
      regdDistrictCode: row.regdDistrictCode,
      regdPincode: row.regdPincode,
      notes: row.notes,
      updatedAt: row.updatedAt.toISOString(),
      promoters: row.promoters.map((p) => ({
        ...p,
        ownershipPercent: p.ownershipPercent?.toString() ?? null,
        panMasked: maskedFromLast4(p.panLast4),
        aadhaarMasked: maskedFromLast4(p.aadhaarLast4, 12),
        dateOfBirth: p.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      })),
      cases: row.cases.map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() })),
    });
  }),
);

/* ------------------------------- update ------------------------------- */

clientsRouter.patch(
  '/:id',
  authorize('client:write'),
  rateLimits.write,
  validate(clientUpdateSchema),
  handler(async (req, res) => {
    const id = req.params.id!;
    const body = valid<ClientUpdateInput>(req);
    const { firmId } = getAuth();

    const existing = await db().client.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, legalName: true, panLast4: true, gstinLast4: true },
    });
    if (!existing) throw notFound('That client');

    if (body.pan || body.gstin) {
      const dup = await findDuplicate(firmId, {
        pan: body.pan ?? null,
        gstin: body.gstin ?? null,
        excludeId: id,
      });
      if (dup) {
        throw duplicateClient(
          `${dup.legalName} already uses that ${dup.on}`,
          dup.id,
          'Two clients in a firm cannot share an identifier.',
        );
      }
    }

    const data = await buildClientData(body, firmId, id);
    const updated = await db().client.update({
      where: { id },
      data: data as Prisma.ClientUncheckedUpdateInput,
      select: LIST_SELECT,
    });

    await writeAudit({
      action: 'CLIENT_UPDATED',
      entityType: 'client',
      entityId: id,
      changedFields: changedFieldNames(null, data),
      metadata: { clientName: updated.legalName },
    });

    res.json(toSummary(updated));
  }),
);

/* ------------------------------- delete ------------------------------- */

clientsRouter.delete(
  '/:id',
  authorize('client:write'),
  rateLimits.write,
  handler(async (req, res) => {
    const id = req.params.id!;
    const { userId } = getAuth();

    const existing = await db().client.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, legalName: true, _count: { select: { cases: true } } },
    });
    if (!existing) throw notFound('That client');

    const activeCases = await db().case.count({
      where: { clientId: id, deletedAt: null, status: { notIn: ['ARCHIVED', 'WITHDRAWN'] } },
    });
    if (activeCases > 0) {
      throw conflict(
        'This client still has active cases',
        'Withdraw or archive the cases first. Client records are never removed while work is open against them.',
      );
    }

    await db().client.update({
      where: { id },
      data: { deletedAt: new Date(), deletedByUserId: userId },
    });

    await writeAudit({
      action: 'CLIENT_DELETED',
      entityType: 'client',
      entityId: id,
      metadata: { clientName: existing.legalName },
    });

    res.status(204).send();
  }),
);

/* ------------------------------- reveal ------------------------------- */

/**
 * The only way to see a full identifier. One field per call, rate limited,
 * permission gated, and always audited with the field NAME.
 */
clientsRouter.post(
  '/:id/reveal',
  authorize('sensitive:reveal'),
  rateLimits.reveal,
  validate(revealFieldSchema),
  handler(async (req, res) => {
    const id = req.params.id!;
    const { field } = valid<RevealFieldInput>(req);
    const { firmId } = getAuth();

    const row = await db().client.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, panEnc: true, gstinEnc: true, udyamEnc: true, legalName: true },
    });
    if (!row) throw notFound('That client');

    const column = field === 'pan' ? 'pan_enc' : field === 'gstin' ? 'gstin_enc' : 'udyam_enc';
    const cipher = field === 'pan' ? row.panEnc : field === 'gstin' ? row.gstinEnc : row.udyamEnc;

    const value = await decryptField(cipher, {
      firmId,
      table: 'client',
      column,
      rowId: id,
    });

    await writeAudit({
      action: 'SENSITIVE_FIELD_REVEALED',
      entityType: 'client',
      entityId: id,
      changedFields: [field],
      metadata: { field, clientName: row.legalName },
    });

    res.json({ field, value });
  }),
);

/* ------------------------------ promoters ----------------------------- */

clientsRouter.post(
  '/:id/promoters',
  authorize('client:write'),
  rateLimits.write,
  validate(promoterCreateSchema),
  handler(async (req, res) => {
    const clientId = req.params.id!;
    const body = valid<PromoterCreateInput>(req);
    const { firmId } = getAuth();

    const client = await db().client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });
    if (!client) throw notFound('That client');

    const id = uuidv7();
    const sealed = await sealIdentifier(body.pan ?? null, {
      firmId,
      table: 'client_promoter',
      column: 'pan_enc',
      rowId: id,
      field: 'promoter.pan',
    });

    if (body.isPrimary) {
      await db().clientPromoter.updateMany({ where: { clientId }, data: { isPrimary: false } });
    }

    const created = await db().clientPromoter.create({
      data: {
        id,
        firmId,
        clientId,
        fullName: body.fullName,
        designation: body.designation,
        ownershipPercent: body.ownershipPercent ? new Prisma.Decimal(body.ownershipPercent) : null,
        panEnc: sealed.enc,
        panLast4: sealed.last4,
        panBlindIndex: sealed.blindIndex,
        aadhaarLast4: body.aadhaarLast4 ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
        addressLine1: body.addressLine1 ?? null,
        city: body.city ?? null,
        pincode: body.pincode ?? null,
        isPrimary: body.isPrimary,
      },
      select: { id: true, fullName: true, designation: true, isPrimary: true, panLast4: true },
    });

    await writeAudit({
      action: 'PROMOTER_CREATED',
      entityType: 'client_promoter',
      entityId: id,
      changedFields: Object.keys(body),
    });

    res.status(201).json({ ...created, panMasked: maskedFromLast4(created.panLast4) });
  }),
);

clientsRouter.patch(
  '/:id/promoters/:promoterId',
  authorize('client:write'),
  rateLimits.write,
  validate(promoterUpdateSchema),
  handler(async (req, res) => {
    const clientId = req.params.id!;
    const promoterId = req.params.promoterId!;
    const body = valid<PromoterUpdateInput>(req);
    const { firmId } = getAuth();

    const existing = await db().clientPromoter.findFirst({
      where: { id: promoterId, clientId },
      select: { id: true },
    });
    if (!existing) throw notFound('That promoter');

    const data: Record<string, unknown> = {};
    for (const key of [
      'fullName',
      'designation',
      'aadhaarLast4',
      'email',
      'phone',
      'addressLine1',
      'city',
      'pincode',
      'isPrimary',
    ] as const) {
      if (key in body) data[key] = (body as Record<string, unknown>)[key];
    }
    if ('ownershipPercent' in body) {
      data.ownershipPercent = body.ownershipPercent
        ? new Prisma.Decimal(body.ownershipPercent)
        : null;
    }
    if ('dateOfBirth' in body) {
      data.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
    }
    if ('pan' in body) {
      const sealed = await sealIdentifier(body.pan ?? null, {
        firmId,
        table: 'client_promoter',
        column: 'pan_enc',
        rowId: promoterId,
        field: 'promoter.pan',
      });
      data.panEnc = sealed.enc;
      data.panLast4 = sealed.last4;
      data.panBlindIndex = sealed.blindIndex;
    }

    if (body.isPrimary) {
      await db().clientPromoter.updateMany({
        where: { clientId, NOT: { id: promoterId } },
        data: { isPrimary: false },
      });
    }

    const updated = await db().clientPromoter.update({
      where: { id: promoterId },
      data: data as Prisma.ClientPromoterUncheckedUpdateInput,
      select: { id: true, fullName: true, designation: true, isPrimary: true, panLast4: true },
    });

    await writeAudit({
      action: 'PROMOTER_UPDATED',
      entityType: 'client_promoter',
      entityId: promoterId,
      changedFields: Object.keys(data),
    });

    res.json({ ...updated, panMasked: maskedFromLast4(updated.panLast4) });
  }),
);

clientsRouter.delete(
  '/:id/promoters/:promoterId',
  authorize('client:write'),
  rateLimits.write,
  handler(async (req, res) => {
    const clientId = req.params.id!;
    const promoterId = req.params.promoterId!;

    const existing = await db().clientPromoter.findFirst({
      where: { id: promoterId, clientId },
      select: { id: true },
    });
    if (!existing) throw notFound('That promoter');

    await db().clientPromoter.delete({ where: { id: promoterId } });
    await writeAudit({
      action: 'PROMOTER_DELETED',
      entityType: 'client_promoter',
      entityId: promoterId,
    });

    res.status(204).send();
  }),
);

clientsRouter.post(
  '/:id/promoters/:promoterId/reveal',
  authorize('sensitive:reveal'),
  rateLimits.reveal,
  handler(async (req, res) => {
    const clientId = req.params.id!;
    const promoterId = req.params.promoterId!;
    const { firmId } = getAuth();

    const row = await db().clientPromoter.findFirst({
      where: { id: promoterId, clientId },
      select: { id: true, panEnc: true },
    });
    if (!row) throw notFound('That promoter');
    if (!row.panEnc) throw badRequest('No PAN is recorded for this promoter');

    const value = await decryptField(row.panEnc, {
      firmId,
      table: 'client_promoter',
      column: 'pan_enc',
      rowId: promoterId,
    });

    await writeAudit({
      action: 'SENSITIVE_FIELD_REVEALED',
      entityType: 'client_promoter',
      entityId: promoterId,
      changedFields: ['pan'],
      metadata: { field: 'pan' },
    });

    res.json({ field: 'pan', value });
  }),
);
