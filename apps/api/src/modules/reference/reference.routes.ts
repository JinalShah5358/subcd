import { Router } from 'express';
import { BANK_NAMES } from '@ifp/shared';
import { db } from '../../auth/context';
import { authenticate, handler, rateLimits } from '../../middleware';
import { enforceLicense } from '../../services/license/license';

export const referenceRouter = Router();
referenceRouter.use(authenticate());
referenceRouter.use(enforceLicense());

/**
 * Reference data for form dropdowns. All read-only for the application role at
 * the database level.
 *
 * District / taluka / DIC codes here are OUR codes. Mapping them to whatever
 * the IFP portal expects is Phase 0 work — nothing assumes these strings
 * appear on the portal.
 */

referenceRouter.get(
  '/districts',
  rateLimits.read,
  handler(async (_req, res) => {
    const rows = await db().district.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, dicCode: true, dicName: true },
      orderBy: { name: 'asc' },
    });
    res.json(rows);
  }),
);

referenceRouter.get(
  '/districts/:code/talukas',
  rateLimits.read,
  handler(async (req, res) => {
    const rows = await db().taluka.findMany({
      where: { isActive: true, district: { code: req.params.code! } },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
    // An empty list is expected for districts whose taluka list has not been
    // captured yet — the UI falls back to free text and says so.
    res.json(rows);
  }),
);

referenceRouter.get(
  '/document-types',
  rateLimits.read,
  handler(async (_req, res) => {
    const rows = await db().documentType.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, description: true, category: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(rows);
  }),
);

referenceRouter.get(
  '/schemes',
  rateLimits.read,
  handler(async (_req, res) => {
    const rows = await db().scheme.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        authority: true,
        versions: {
          select: {
            id: true,
            versionLabel: true,
            status: true,
            effectiveFrom: true,
            effectiveTo: true,
            sourceReference: true,
          },
          orderBy: { effectiveFrom: 'desc' },
        },
      },
    });

    res.json(
      rows.map((s) => ({
        ...s,
        versions: s.versions.map((v) => ({
          ...v,
          effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10),
          effectiveTo: v.effectiveTo?.toISOString().slice(0, 10) ?? null,
          unverified: v.sourceReference === null,
        })),
      })),
    );
  }),
);

referenceRouter.get(
  '/banks',
  rateLimits.read,
  handler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const rows = await db().bank.findMany({
      where: {
        isActive: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { branchName: { contains: q, mode: 'insensitive' } },
                { ifsc: { contains: q.toUpperCase() } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, branchName: true, ifsc: true, bankType: true, city: true },
      orderBy: [{ name: 'asc' }, { branchName: 'asc' }],
      take: 50,
    });
    res.json(rows);
  }),
);

/** Names only, for the "add a bank" typeahead. We ship no branch directory. */
referenceRouter.get(
  '/bank-names',
  rateLimits.read,
  handler(async (_req, res) => {
    res.json(BANK_NAMES);
  }),
);
