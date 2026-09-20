import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import {
  ASSIGNABLE_ROLE_KEYS,
  auditSearchSchema,
  inviteUserSchema,
  updateFirmSchema,
  updateUserSchema,
  userSearchSchema,
  uuidv7,
  type AuditSearchInput,
  type InviteUserInput,
  type UpdateFirmInput,
  type UpdateUserInput,
  type UserSearchInput,
} from '@ifp/shared';
import type { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { findEmailOwner } from '../../auth/lookups';
import { db, getAuth } from '../../auth/context';
import { authenticate, authorize, handler, rateLimits, valid, validate } from '../../middleware';
import {
  assertQuota,
  enforceLicense,
  firmLicense,
  licenseSummary,
} from '../../services/license/license';
import { revokeAllUserTokens } from '../../auth/tokens';
import { writeAudit } from '../../services/audit/auditWriter';
import { sendMail } from '../../services/mail';
import { pageSlice, toPage } from '../../utils/pagination';
import { badRequest, conflict, forbidden, notFound } from '../../utils/problem';

export const adminRouter = Router();
adminRouter.use(authenticate());
adminRouter.use(enforceLicense());

/* -------------------------------- firm -------------------------------- */

adminRouter.get(
  '/firms/current',
  rateLimits.read,
  handler(async (_req, res) => {
    const { firmId } = getAuth();
    const firm = await db().firm.findFirst({
      where: { id: firmId },
      select: {
        id: true,
        name: true,
        slug: true,
        frn: true,
        gstin: true,
        contactEmail: true,
        contactPhone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        pincode: true,
        status: true,
        dataRegion: true,
        retentionMonths: true,
        createdAt: true,
        _count: { select: { users: true, clients: true, cases: true } },
      },
    });
    if (!firm) throw notFound('Your firm');

    // The licence rides along with firm settings so the app has one place to
    // learn it. The firm can see what it is allowed; it cannot change it —
    // the update schema below carries no licence field and a database trigger
    // refuses one arriving any other way.
    const license = await firmLicense(firmId);

    res.json({
      ...firm,
      createdAt: firm.createdAt.toISOString(),
      license: licenseSummary(license),
    });
  }),
);

adminRouter.patch(
  '/firms/current',
  authorize('firm:manage'),
  rateLimits.write,
  validate(updateFirmSchema),
  handler(async (req, res) => {
    const body = valid<UpdateFirmInput>(req);
    const { firmId } = getAuth();

    const data = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    ) as Prisma.FirmUncheckedUpdateInput;

    const updated = await db().firm.update({
      where: { id: firmId },
      data,
      select: { id: true, name: true, slug: true },
    });

    await writeAudit({
      action: 'FIRM_UPDATED',
      entityType: 'firm',
      entityId: firmId,
      changedFields: Object.keys(data),
    });

    res.json(updated);
  }),
);

/* -------------------------------- users ------------------------------- */

adminRouter.get(
  '/users',
  authorize('user:manage'),
  rateLimits.read,
  validate(userSearchSchema, 'query'),
  handler(async (req, res) => {
    const q = valid<UserSearchInput>(req, 'query');

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.roleKey ? { role: { key: q.roleKey } } : {}),
      ...(q.q
        ? {
            OR: [
              { fullName: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.UserOrderByWithRelationInput =
      q.sort === 'email'
        ? { email: q.dir }
        : q.sort === 'lastLoginAt'
          ? { lastLoginAt: q.dir }
          : q.sort === 'createdAt'
            ? { createdAt: q.dir }
            : { fullName: q.dir };

    const [users, total] = await Promise.all([
      db().user.findMany({
        where,
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          role: { select: { id: true, key: true, name: true } },
        },
        orderBy,
        ...pageSlice(q),
      }),
      db().user.count({ where }),
    ]);

    res.json(
      toPage(
        users.map((u) => ({
          ...u,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        })),
        total,
        q,
      ),
    );
  }),
);

adminRouter.get(
  '/users/invitations',
  authorize('user:manage'),
  rateLimits.read,
  handler(async (_req, res) => {
    const rows = await db().invitation.findMany({
      where: { acceptedAt: null, revokedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        expiresAt: true,
        createdAt: true,
        role: { select: { key: true, name: true } },
        invitedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(
      rows.map((r) => ({
        ...r,
        expiresAt: r.expiresAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        expired: r.expiresAt.getTime() < Date.now(),
      })),
    );
  }),
);

adminRouter.post(
  '/users/invitations',
  authorize('user:manage'),
  rateLimits.write,
  validate(inviteUserSchema),
  handler(async (req, res) => {
    const body = valid<InviteUserInput>(req);
    const { firmId, userId } = getAuth();

    if (!ASSIGNABLE_ROLE_KEYS.includes(body.roleKey as (typeof ASSIGNABLE_ROLE_KEYS)[number])) {
      throw badRequest('That role cannot be assigned');
    }

    // A user belongs to exactly one firm in the MVP (ADR-004). This check has to
    // see across tenants, so it goes through the narrow SECURITY DEFINER lookup
    // rather than a tenant-scoped query that would always come back empty.
    const existing = await findEmailOwner(body.email);
    if (existing) {
      throw conflict(
        existing.firmId === firmId
          ? 'That person already has an account in this firm'
          : 'That email address is already registered',
      );
    }

    // Seats count outstanding invitations too — see `firm_license_state`.
    await assertQuota(firmId, 'users');

    const role = await db().role.findFirst({
      where: { key: body.roleKey, firmId: null },
      select: { id: true, key: true },
    });
    if (!role) throw notFound('That role');

    const raw = randomBytes(32).toString('base64url');
    const id = uuidv7();

    await db().invitation.create({
      data: {
        id,
        firmId,
        email: body.email,
        fullName: body.fullName,
        roleId: role.id,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        invitedByUserId: userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await sendMail({
      to: body.email,
      subject: 'You have been invited to the IFP platform',
      text:
        `Hello ${body.fullName},\n\n` +
        `You have been invited to join your firm's IFP subsidy case platform.\n` +
        `Set your password here (link valid for 7 days):\n` +
        `${env.WEB_ORIGIN}/accept-invite?token=${raw}\n`,
    });

    await writeAudit({
      action: 'USER_INVITED',
      entityType: 'invitation',
      entityId: id,
      metadata: { invitedEmail: body.email, roleKey: role.key },
    });

    res.status(201).json({ id, email: body.email, expiresInDays: 7 });
  }),
);

adminRouter.delete(
  '/users/invitations/:id',
  authorize('user:manage'),
  rateLimits.write,
  handler(async (req, res) => {
    const id = req.params.id!;
    const invitation = await db().invitation.findFirst({
      where: { id, acceptedAt: null },
      select: { id: true, email: true },
    });
    if (!invitation) throw notFound('That invitation');

    await db().invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await writeAudit({
      action: 'USER_UPDATED',
      entityType: 'invitation',
      entityId: id,
      metadata: { invitedEmail: invitation.email, reason: 'invitation revoked' },
    });
    res.status(204).send();
  }),
);

adminRouter.patch(
  '/users/:id',
  authorize('user:manage'),
  rateLimits.write,
  validate(updateUserSchema),
  handler(async (req, res) => {
    const id = req.params.id!;
    const body = valid<UpdateUserInput>(req);
    const { userId, firmId } = getAuth();

    const target = await db().user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, email: true, role: { select: { key: true } } },
    });
    if (!target) throw notFound('That user');

    // No self-escalation: an admin cannot change their own role.
    if (id === userId && body.roleKey && body.roleKey !== target.role.key) {
      throw forbidden('You cannot change your own role');
    }

    const data: Prisma.UserUncheckedUpdateInput = {};
    if (body.fullName) data.fullName = body.fullName;
    if (body.phone !== undefined) data.phone = body.phone ?? null;

    let roleChanged = false;
    if (body.roleKey && body.roleKey !== target.role.key) {
      const role = await db().role.findFirst({
        where: { key: body.roleKey, firmId: null },
        select: { id: true },
      });
      if (!role) throw notFound('That role');
      data.roleId = role.id;
      roleChanged = true;
    }

    const updated = await db().user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        status: true,
        role: { select: { key: true, name: true } },
      },
    });

    if (roleChanged) {
      // Permissions are read fresh on every request, so the change is already
      // live; revoking refresh tokens forces a clean re-login as well.
      await revokeAllUserTokens(firmId, id, 'ROLE_CHANGED');
      await writeAudit({
        action: 'ROLE_CHANGED',
        entityType: 'user',
        entityId: id,
        metadata: { previousRoleKey: target.role.key, roleKey: body.roleKey!, targetUserId: id },
      });
    }

    await writeAudit({
      action: 'USER_UPDATED',
      entityType: 'user',
      entityId: id,
      changedFields: Object.keys(data),
      metadata: { targetUserId: id },
    });

    res.json(updated);
  }),
);

adminRouter.post(
  '/users/:id/disable',
  authorize('user:manage'),
  rateLimits.write,
  handler(async (req, res) => {
    const id = req.params.id!;
    const { userId, firmId } = getAuth();
    if (id === userId) throw forbidden('You cannot disable your own account');

    const target = await db().user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, email: true },
    });
    if (!target) throw notFound('That user');

    await db().user.update({ where: { id }, data: { status: 'DISABLED' } });
    // Immediate effect: every session dies now, not in 15 minutes.
    await revokeAllUserTokens(firmId, id, 'USER_DISABLED');

    await writeAudit({
      action: 'USER_DISABLED',
      entityType: 'user',
      entityId: id,
      metadata: { targetUserId: id },
    });

    res.status(204).send();
  }),
);

adminRouter.post(
  '/users/:id/enable',
  authorize('user:manage'),
  rateLimits.write,
  handler(async (req, res) => {
    const id = req.params.id!;
    const target = await db().user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, passwordHash: true },
    });
    if (!target) throw notFound('That user');

    await db().user.update({
      where: { id },
      data: { status: target.passwordHash ? 'ACTIVE' : 'INVITED', failedLoginCount: 0, lockedUntil: null },
    });

    await writeAudit({
      action: 'USER_UPDATED',
      entityType: 'user',
      entityId: id,
      metadata: { targetUserId: id, reason: 'enabled' },
    });

    res.status(204).send();
  }),
);

/* -------------------------------- audit ------------------------------- */

adminRouter.get(
  '/audit',
  authorize('audit:read'),
  rateLimits.read,
  validate(auditSearchSchema, 'query'),
  handler(async (req, res) => {
    const q = valid<AuditSearchInput>(req, 'query');

    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: q.action } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.from || q.to
        ? {
            occurredAt: {
              ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      db().auditLog.findMany({ where, orderBy: { id: q.dir }, ...pageSlice(q) }),
      db().auditLog.count({ where }),
    ]);

    res.json(
      toPage(
        rows.map((r) => ({
          id: r.id,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          actorUserId: r.actorUserId,
          actorEmail: r.actorEmailSnapshot,
          actorRole: r.actorRoleSnapshot,
          clientType: r.clientType,
          outcome: r.outcome,
          failureReason: r.failureReason,
          ipAddress: r.ipAddress,
          requestId: r.requestId,
          changedFields: r.changedFields,
          metadata: r.metadata,
          occurredAt: r.occurredAt.toISOString(),
        })),
        total,
        q,
      ),
    );
  }),
);

adminRouter.get(
  '/audit/entities/:type/:id',
  authorize('audit:read'),
  rateLimits.read,
  handler(async (req, res) => {
    const rows = await db().auditLog.findMany({
      where: { entityType: req.params.type!, entityId: req.params.id! },
      orderBy: { id: 'desc' },
      take: 100,
    });

    res.json(
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorEmail: r.actorEmailSnapshot,
        outcome: r.outcome,
        changedFields: r.changedFields,
        metadata: r.metadata,
        occurredAt: r.occurredAt.toISOString(),
      })),
    );
  }),
);
