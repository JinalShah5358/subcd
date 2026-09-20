import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import {
  PLAN_DEFAULTS,
  defaultExpiryFor,
  firmCreateSchema,
  firmStatusChangeSchema,
  licenseStatus,
  licenseUpdateSchema,
  platformFirmSearchSchema,
  platformLicenseSearchSchema,
  uuidv7,
  type FirmCreateInput,
  type FirmStatusChangeInput,
  type LicenseCreateInput,
  type LicensePlan,
  type LicenseUpdateInput,
  type PlatformFirmSearchInput,
  type PlatformLicenseSearchInput,
} from '@ifp/shared';
import { env } from '../../config/env';
import { getAuth } from '../../auth/context';
import { findEmailOwner } from '../../auth/lookups';
import * as platform from '../../auth/platform';
import { withTenant } from '../../db/tenant';
import { authenticate, authorize, handler, rateLimits, valid, validate } from '../../middleware';
import { writeAudit } from '../../services/audit/auditWriter';
import { sendMail } from '../../services/mail';
import { badRequest, conflict, notFound } from '../../utils/problem';
import { pageSlice, toPage } from '../../utils/pagination';

/**
 * Platform administration.
 *
 * This is the only part of the API that sees across firms, and it is kept
 * deliberately thin. It can provision a tenant, suspend one, and count what
 * is inside one. It cannot open one: every route here reads through the
 * SECURITY DEFINER functions in `auth/platform.ts`, whose return types carry
 * no client, case, identifier or document data at all.
 *
 * That is the whole design. A platform administrator running a SaaS needs to
 * know that Firm X exists, has 212 clients and has not signed in for three
 * months. They have no business knowing who those clients are, and the
 * boundary is drawn in the database so that no amount of route code can move
 * it.
 */
export const platformRouter = Router();
platformRouter.use(authenticate());
platformRouter.use(authorize('platform:admin'));

/** bigint from a COUNT(*) does not survive JSON.stringify. */
const n = (value: bigint | number): number => Number(value);

/**
 * The licence as the console renders it: the stored settings, the derived
 * state, and usage against each limit.
 *
 * Derived here rather than in the browser so that the console and the API's
 * own refusals cannot drift apart — both call `licenseStatus` from shared
 * code with the same inputs.
 */
function licenseView(
  row: {
    plan: string;
    license_expires_at: Date | null;
    license_grace_days: number;
    max_users: number | null;
    max_clients: number | null;
    max_cases: number | null;
  },
  used: { users: number; clients: number; cases: number },
  now = new Date(),
) {
  const status = licenseStatus(
    {
      plan: row.plan as LicensePlan,
      expiresAt: row.license_expires_at,
      graceDays: row.license_grace_days,
      maxUsers: row.max_users,
      maxClients: row.max_clients,
      maxCases: row.max_cases,
    },
    now,
  );

  return {
    plan: status.plan,
    state: status.state,
    readOnly: status.readOnly,
    expiresAt: status.expiresAt,
    daysRemaining: status.daysRemaining,
    graceDays: status.graceDays,
    graceDaysRemaining: status.graceDaysRemaining,
    limits: { users: status.maxUsers, clients: status.maxClients, cases: status.maxCases },
    used,
  };
}

/* -------------------------------- totals -------------------------------- */

platformRouter.get(
  '/totals',
  rateLimits.read,
  handler(async (_req, res) => {
    const t = await platform.totals();
    res.json({
      firmCount: n(t.firm_count),
      activeFirms: n(t.active_firms),
      suspendedFirms: n(t.suspended_firms),
      userCount: n(t.user_count),
      clientCount: n(t.client_count),
      caseCount: n(t.case_count),
    });
  }),
);

/* -------------------------------- firms --------------------------------- */

platformRouter.get(
  '/firms',
  rateLimits.read,
  validate(platformFirmSearchSchema, 'query'),
  handler(async (req, res) => {
    const q = valid<PlatformFirmSearchInput>(req, 'query');
    const { skip, take } = pageSlice(q);

    const rows = await platform.listFirms({
      search: q.q,
      status: q.status,
      limit: take,
      offset: skip,
    });

    // The function reports the unpaged total on every row; with no rows there
    // is nothing to report and the total is genuinely zero.
    const total = rows.length > 0 ? n(rows[0]!.total_count) : 0;

    res.json(
      toPage(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          frn: r.frn,
          status: r.status,
          dataRegion: r.data_region,
          contactEmail: r.contact_email,
          createdAt: r.created_at.toISOString(),
          userCount: n(r.user_count),
          clientCount: n(r.client_count),
          caseCount: n(r.case_count),
          lastActiveAt: r.last_active_at?.toISOString() ?? null,
          license: licenseView(r, {
            users: n(r.user_count),
            clients: n(r.client_count),
            cases: n(r.case_count),
          }),
        })),
        total,
        q,
      ),
    );
  }),
);

platformRouter.get(
  '/firms/:id',
  rateLimits.read,
  handler(async (req, res) => {
    const row = await platform.firmDetail(String(req.params.id));
    if (!row) throw notFound('That firm');

    res.json({
      id: row.id,
      name: row.name,
      slug: row.slug,
      frn: row.frn,
      gstin: row.gstin,
      status: row.status,
      dataRegion: row.data_region,
      retentionMonths: row.retention_months,
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      city: row.city,
      state: row.state,
      createdAt: row.created_at.toISOString(),
      userCount: n(row.user_count),
      activeUserCount: n(row.active_user_count),
      clientCount: n(row.client_count),
      caseCount: n(row.case_count),
      lastActiveAt: row.last_active_at?.toISOString() ?? null,
      license: {
        ...licenseView(row, {
          users: n(row.user_count),
          clients: n(row.client_count),
          cases: n(row.case_count),
        }),
        note: row.license_note,
        updatedAt: row.license_updated_at?.toISOString() ?? null,
      },
    });
  }),
);

/**
 * Provision a firm and invite its first administrator.
 *
 * Both, or neither. A firm nobody can sign in to is not a provisioned tenant,
 * it is a row someone has to find and clean up later — so the administrator's
 * invitation is part of the same operation.
 *
 * The firm row is created through the one SECURITY DEFINER write; everything
 * after it runs through the ordinary `withTenant` path, because once the row
 * exists the normal RLS policies admit writes scoped to it. The invitation
 * therefore takes exactly the route every other invitation takes, hashed
 * token and all.
 */
platformRouter.post(
  '/firms',
  rateLimits.write,
  validate(firmCreateSchema),
  handler(async (req, res) => {
    const body = valid<FirmCreateInput>(req);
    const actor = getAuth();

    if (await platform.slugTaken(body.slug)) {
      throw conflict('That slug is already in use by another firm');
    }

    // One account, one firm (ADR-004). This has to see across tenants, so it
    // goes through the narrow lookup rather than a scoped query that would
    // always come back empty.
    if (await findEmailOwner(body.adminEmail)) {
      throw conflict('That email address already has an account on the platform');
    }

    const firmId = uuidv7();
    const license = resolveInitialLicense(body.license);
    await platform.createFirm({
      id: firmId,
      name: body.name,
      slug: body.slug,
      frn: body.frn,
      contactEmail: body.contactEmail,
      city: body.city,
      state: body.state,
      dataRegion: body.dataRegion,
      ...license,
    });

    const rawToken = randomBytes(32).toString('base64url');

    const invitation = await withTenant(firmId, async (tx) => {
      const role = await tx.role.findFirst({
        where: { key: 'FIRM_ADMIN', firmId: null },
        select: { id: true },
      });
      if (!role) throw badRequest('The FIRM_ADMIN role is missing — run the seed');

      return tx.invitation.create({
        data: {
          id: uuidv7(),
          firmId,
          email: body.adminEmail,
          fullName: body.adminFullName,
          roleId: role.id,
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          // Deliberately no invitedByUserId: the platform admin is not a
          // member of this firm, and the column is a foreign key into its
          // own users.
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
        select: { id: true, email: true, expiresAt: true },
      });
    });

    await sendMail({
      to: body.adminEmail,
      subject: `Your firm is set up on the IFP platform`,
      text:
        `${body.adminFullName},\n\n` +
        `${body.name} has been set up on the IFP subsidy platform, and you have been made its administrator.\n\n` +
        `Set your password here (the link is single-use and expires in 7 days):\n` +
        `${env.WEB_ORIGIN}/accept-invite?token=${rawToken}\n\n` +
        `You will be able to invite the rest of your team once you are in.\n`,
    });

    // Audited against the NEW firm, so it is the first entry in that firm's
    // own trail — and names the platform user who created it.
    await writeAudit({
      action: 'FIRM_CREATED',
      entityType: 'firm',
      entityId: firmId,
      firmId,
      changedFields: ['name', 'slug', 'status'],
      metadata: { slug: body.slug, provisionedBy: actor.email ?? actor.userId },
    });

    await writeAudit({
      action: 'FIRM_LICENSE_CHANGED',
      entityType: 'firm',
      entityId: firmId,
      firmId,
      changedFields: ['plan', 'licenseExpiresAt', 'maxUsers', 'maxClients', 'maxCases'],
      metadata: {
        plan: license.plan,
        expiresAt: license.expiresAt,
        reason: 'Initial licence set at provisioning',
        changedBy: actor.email ?? actor.userId,
      },
    });

    res.status(201).json({
      id: firmId,
      name: body.name,
      slug: body.slug,
      status: 'ACTIVE',
      license: {
        plan: license.plan,
        expiresAt: license.expiresAt,
        graceDays: license.graceDays,
        limits: {
          users: license.maxUsers,
          clients: license.maxClients,
          cases: license.maxCases,
        },
      },
      invitation: {
        id: invitation.id,
        email: invitation.email,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    });
  }),
);

/**
 * Suspend or reactivate a firm.
 *
 * Suspension refuses sign-in for everyone in that firm. It deletes nothing and
 * archives nothing — the data stays exactly where it is, which is the only
 * defensible behaviour when the firm's own client records are at stake and the
 * reason might turn out to be an administrative error.
 */
platformRouter.patch(
  '/firms/:id/status',
  rateLimits.write,
  validate(firmStatusChangeSchema),
  handler(async (req, res) => {
    const body = valid<FirmStatusChangeInput>(req);
    const id = String(req.params.id);
    const actor = getAuth();

    const before = await platform.firmDetail(id);
    if (!before) throw notFound('That firm');
    if (before.status === body.status) {
      throw badRequest(`That firm is already ${body.status.toLowerCase()}`);
    }

    const updated = await platform.setFirmStatus(id, body.status);
    if (!updated) throw notFound('That firm');

    await writeAudit({
      action: 'FIRM_STATUS_CHANGED',
      entityType: 'firm',
      entityId: id,
      firmId: id,
      changedFields: ['status'],
      metadata: {
        from: before.status,
        to: body.status,
        reason: body.reason,
        changedBy: actor.email ?? actor.userId,
      },
    });

    res.json({ id: updated.id, name: updated.name, status: updated.status });
  }),
);

/* ------------------------------- licensing ------------------------------- */

/**
 * The licence a firm is provisioned with.
 *
 * Everything is optional at the call site and each gap falls back to the
 * plan's defaults, so "create a firm and don't think about licensing" yields a
 * 30-day trial rather than an unlimited licence nobody meant to grant. That
 * asymmetry is the point: forgetting should cost the customer a conversation,
 * not cost us the product.
 */
function resolveInitialLicense(input: LicenseCreateInput | undefined) {
  const plan: LicensePlan = input?.plan ?? 'TRIAL';
  const defaults = PLAN_DEFAULTS[plan];

  return {
    plan,
    expiresAt: input?.expiresAt ?? defaultExpiryFor(plan, new Date()),
    graceDays: input?.graceDays ?? defaults.graceDays,
    maxUsers: input?.maxUsers ?? defaults.maxUsers,
    maxClients: input?.maxClients ?? defaults.maxClients,
    maxCases: input?.maxCases ?? defaults.maxCases,
    licenseNote: input?.note ?? null,
  };
}

/**
 * Set or renew a firm's licence.
 *
 * PUT, not PATCH: a licence is replaced wholesale. A partial update would make
 * "clear the client limit" and "don't mention the client limit" the same
 * request, and those mean opposite things.
 *
 * The response carries the resulting state, not just the stored values, so the
 * console can immediately say "read-only in 3 days" rather than re-deriving it
 * and possibly deriving it differently.
 */
platformRouter.put(
  '/firms/:id/license',
  rateLimits.write,
  validate(licenseUpdateSchema),
  handler(async (req, res) => {
    const body = valid<LicenseUpdateInput>(req);
    const id = String(req.params.id);
    const actor = getAuth();

    const before = await platform.firmDetail(id);
    if (!before) throw notFound('That firm');

    const updated = await platform.setFirmLicense({
      id,
      plan: body.plan,
      expiresAt: body.expiresAt,
      graceDays: body.graceDays,
      maxUsers: body.maxUsers,
      maxClients: body.maxClients,
      maxCases: body.maxCases,
      note: body.note,
    });
    if (!updated) throw notFound('That firm');

    // Refuse to silently set a limit the firm is already past. It would not
    // delete anything — quotas are checked on creation, not retroactively —
    // but a limit of 10 on a firm holding 40 clients is almost always a typo,
    // and finding out through a support call is worse than finding out here.
    const over: string[] = [];
    if (body.maxUsers !== null && n(before.user_count) > body.maxUsers) over.push('users');
    if (body.maxClients !== null && n(before.client_count) > body.maxClients) over.push('clients');
    if (body.maxCases !== null && n(before.case_count) > body.maxCases) over.push('cases');

    await writeAudit({
      action: 'FIRM_LICENSE_CHANGED',
      entityType: 'firm',
      entityId: id,
      firmId: id,
      changedFields: [
        'plan',
        'licenseExpiresAt',
        'licenseGraceDays',
        'maxUsers',
        'maxClients',
        'maxCases',
      ],
      metadata: {
        from: before.plan,
        to: body.plan,
        expiresAt: body.expiresAt,
        reason: body.reason,
        changedBy: actor.email ?? actor.userId,
      },
    });

    res.json({
      id: updated.id,
      name: updated.name,
      license: {
        ...licenseView(updated, {
          users: n(before.user_count),
          clients: n(before.client_count),
          cases: n(before.case_count),
        }),
        note: updated.license_note,
        updatedAt: updated.license_updated_at?.toISOString() ?? null,
      },
      /** Limits now below current usage. Advisory — nothing was removed. */
      alreadyOverLimit: over,
    });
  }),
);

/**
 * The renewals list: licences that have ended, or end within N days.
 *
 * Ordered expired-first then soonest, which is the order somebody actually
 * works through them. A firm with no expiry never appears here.
 */
platformRouter.get(
  '/licenses/expiring',
  rateLimits.read,
  validate(platformLicenseSearchSchema, 'query'),
  handler(async (req, res) => {
    const q = valid<PlatformLicenseSearchInput>(req, 'query');
    const { skip, take } = pageSlice(q);

    const rows = await platform.listExpiring({
      withinDays: q.withinDays,
      limit: take,
      offset: skip,
    });
    const total = rows.length > 0 ? n(rows[0]!.total_count) : 0;

    const now = new Date();
    res.json(
      toPage(
        rows.map((r) => {
          const status = licenseStatus(
            {
              plan: r.plan as LicensePlan,
              expiresAt: r.license_expires_at,
              graceDays: r.license_grace_days,
              maxUsers: null,
              maxClients: null,
              maxCases: null,
            },
            now,
          );
          return {
            id: r.id,
            name: r.name,
            slug: r.slug,
            status: r.status,
            contactEmail: r.contact_email,
            plan: status.plan,
            state: status.state,
            readOnly: status.readOnly,
            expiresAt: status.expiresAt,
            daysRemaining: status.daysRemaining,
            graceDaysRemaining: status.graceDaysRemaining,
          };
        }),
        total,
        q,
      ),
    );
  }),
);
