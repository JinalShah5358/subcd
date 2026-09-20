import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  uuidv7,
  type AcceptInvitationInput,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
  type SessionUser,
} from '@ifp/shared';
import { env } from '../../config/env';
import { withTenant } from '../../db/tenant';
import { getAuth, getContext } from '../../auth/context';
import {
  findEmailOwner,
  findInvitation,
  findResetToken,
  findUserByEmail,
  findUserById,
} from '../../auth/lookups';
import {
  burnPasswordVerification,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../../auth/password';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  issueRefreshToken,
  revokeAllUserTokens,
  revokeTokenByValue,
  rotateRefreshToken,
  setRefreshCookie,
  signAccessToken,
} from '../../auth/tokens';
import { authenticate, handler, rateLimits, valid, validate } from '../../middleware';
import { writeAudit } from '../../services/audit/auditWriter';
import { sendMail } from '../../services/mail';
import {
  afterFailedAttempt,
  afterSuccessfulAttempt,
  isLocked,
} from '../../auth/lockout';
import { badRequest, notFound, unauthorized } from '../../utils/problem';

export const authRouter = Router();


/**
 * Builds the session payload. Runs inside the tenant transaction so the RLS
 * policy is satisfied by the normal path rather than bypassed.
 */
async function buildSessionUser(userId: string, firmId: string): Promise<SessionUser> {
  return withTenant(firmId, async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        status: true,
        lastLoginAt: true,
        role: { select: { id: true, key: true, name: true, permissions: true } },
        firm: { select: { id: true, name: true, slug: true, status: true } },
      },
    });
    if (!user) throw notFound('Your account');

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      status: user.status,
      role: { id: user.role.id, key: user.role.key, name: user.role.name },
      permissions: user.role.permissions,
      firm: user.firm,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  });
}

/* ------------------------------- login -------------------------------- */

authRouter.post(
  '/login',
  rateLimits.login,
  validate(loginSchema),
  handler(async (req, res) => {
    const body = valid<LoginInput>(req);
    const ctx = getContext();

    const user = await findUserByEmail(body.email);

    // Same shape and similar timing whether or not the account exists.
    if (!user || !user.password_hash || user.deleted_at) {
      await burnPasswordVerification();
      throw unauthorized('Email or password is incorrect');
    }

    if (isLocked(user.locked_until)) {
      await writeAudit({
        action: 'LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        outcome: 'FAILURE',
        failureReason: 'account locked',
        firmId: user.firm_id,
        actorUserId: user.id,
        actorEmail: user.email,
      });
      throw unauthorized('Too many failed attempts. Try again in a few minutes.');
    }

    const ok = await verifyPassword(body.password, user.password_hash);

    if (!ok) {
      await withTenant(user.firm_id, (tx) =>
        tx.user.update({
          where: { id: user.id },
          data: afterFailedAttempt(user.failed_login_count),
        }),
      );
      await writeAudit({
        action: 'LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        outcome: 'FAILURE',
        failureReason: 'bad password',
        firmId: user.firm_id,
        actorUserId: user.id,
        actorEmail: user.email,
      });
      throw unauthorized('Email or password is incorrect');
    }

    if (user.status !== 'ACTIVE') throw unauthorized('This account is not active');
    if (user.firm_status !== 'ACTIVE') throw unauthorized('This firm account is suspended');

    // Opportunistic hash upgrade when parameters have been raised.
    const dataUpdate: Record<string, unknown> = {
      ...afterSuccessfulAttempt(),
      lastLoginAt: new Date(),
      lastLoginIp: ctx.ip ?? null,
    };
    if (needsRehash(user.password_hash)) {
      dataUpdate.passwordHash = await hashPassword(body.password);
      dataUpdate.passwordUpdatedAt = new Date();
    }
    await withTenant(user.firm_id, (tx) =>
      tx.user.update({ where: { id: user.id }, data: dataUpdate }),
    );

    const { token, expiresInSeconds } = signAccessToken({
      sub: user.id,
      firmId: user.firm_id,
      roleKey: user.role_key,
      perms: user.role_permissions,
      clientType: 'WEB',
    });

    const refresh = await issueRefreshToken({
      userId: user.id,
      firmId: user.firm_id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    setRefreshCookie(res, refresh);

    ctx.auth = {
      userId: user.id,
      firmId: user.firm_id,
      email: user.email,
      roleKey: user.role_key,
      permissions: user.role_permissions,
    };

    await writeAudit({ action: 'LOGIN_SUCCEEDED', entityType: 'user', entityId: user.id });

    res.json({
      accessToken: token,
      expiresInSeconds,
      user: await buildSessionUser(user.id, user.firm_id),
    });
  }),
);

/* ------------------------------- refresh ------------------------------- */

authRouter.post(
  '/refresh',
  rateLimits.refresh,
  handler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw || typeof raw !== 'string') throw unauthorized('Please sign in again');

    const ctx = getContext();
    let rotated;
    try {
      rotated = await rotateRefreshToken(raw, { ip: ctx.ip, userAgent: ctx.userAgent });
    } catch (err) {
      clearRefreshCookie(res);
      const detail = err as { reuseDetected?: boolean; firmId?: string; userId?: string };
      if (detail.reuseDetected && detail.firmId) {
        await writeAudit({
          action: 'TOKEN_REUSE_DETECTED',
          entityType: 'refresh_token',
          outcome: 'FAILURE',
          failureReason: 'spent token presented',
          firmId: detail.firmId,
          actorUserId: detail.userId ?? null,
        }).catch(() => undefined);
      }
      throw err;
    }

    const user = await findUserById(rotated.userId);
    if (!user) throw unauthorized('Please sign in again');

    const { token, expiresInSeconds } = signAccessToken({
      sub: user.id,
      firmId: user.firm_id,
      roleKey: user.role_key,
      perms: user.role_permissions,
      clientType: 'WEB',
    });

    setRefreshCookie(res, rotated.rawToken);

    ctx.auth = {
      userId: user.id,
      firmId: user.firm_id,
      email: user.email,
      roleKey: user.role_key,
      permissions: user.role_permissions,
    };
    await writeAudit({ action: 'TOKEN_REFRESHED', entityType: 'user', entityId: user.id });

    res.json({
      accessToken: token,
      expiresInSeconds,
      user: await buildSessionUser(user.id, user.firm_id),
    });
  }),
);

/* ------------------------------- logout -------------------------------- */

authRouter.post(
  '/logout',
  authenticate({ optional: true }),
  handler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw && typeof raw === 'string') {
      await revokeTokenByValue(raw, 'LOGOUT');
    }
    clearRefreshCookie(res);
    const ctx = getContext();
    if (ctx.auth) {
      await writeAudit({ action: 'LOGOUT', entityType: 'user', entityId: ctx.auth.userId });
    }
    res.status(204).send();
  }),
);

/* --------------------------------- me ---------------------------------- */

authRouter.get(
  '/me',
  authenticate(),
  handler(async (_req, res) => {
    const auth = getAuth();
    res.json({ user: await buildSessionUser(auth.userId, auth.firmId) });
  }),
);

/* --------------------------- password reset ---------------------------- */

authRouter.post(
  '/password/forgot',
  rateLimits.passwordReset,
  validate(forgotPasswordSchema),
  handler(async (req, res) => {
    const body = valid<ForgotPasswordInput>(req);
    const ctx = getContext();

    const user = await findUserByEmail(body.email);

    // Always 202: never disclose whether an address is registered.
    if (user && user.status !== 'DISABLED' && !user.deleted_at) {
      const raw = randomBytes(32).toString('base64url');

      const fullName = await withTenant(user.firm_id, async (tx) => {
        await tx.passwordResetToken.create({
          data: {
            id: uuidv7(),
            firmId: user.firm_id,
            userId: user.id,
            tokenHash: createHash('sha256').update(raw).digest('hex'),
            requestIp: ctx.ip ?? null,
            expiresAt: new Date(Date.now() + 15 * 60_000),
          },
        });
        const row = await tx.user.findFirst({
          where: { id: user.id },
          select: { fullName: true },
        });
        return row?.fullName ?? 'there';
      });

      await sendMail({
        to: user.email,
        subject: 'Reset your IFP platform password',
        text:
          `Hello ${fullName},\n\n` +
          `Use this link within 15 minutes to set a new password:\n` +
          `${env.WEB_ORIGIN}/reset-password?token=${raw}\n\n` +
          `If you did not ask for this, you can ignore this email.`,
      });

      await writeAudit({
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'user',
        entityId: user.id,
        firmId: user.firm_id,
        actorUserId: user.id,
        actorEmail: user.email,
      });
    }

    res.status(202).json({ message: 'If that address is registered, a reset link has been sent.' });
  }),
);

authRouter.post(
  '/password/reset',
  rateLimits.passwordReset,
  validate(resetPasswordSchema),
  handler(async (req, res) => {
    const body = valid<ResetPasswordInput>(req);
    const tokenHash = createHash('sha256').update(body.token).digest('hex');

    const record = await findResetToken(tokenHash);

    if (!record || record.used_at || new Date(record.expires_at).getTime() < Date.now()) {
      throw badRequest('That reset link is invalid or has expired');
    }

    const passwordHash = await hashPassword(body.password);

    await withTenant(record.firm_id, async (tx) => {
      await tx.user.update({
        where: { id: record.user_id },
        data: {
          passwordHash,
          passwordUpdatedAt: new Date(),
          // A completed reset clears the lockout — it is the documented way
          // back in for a locked-out user, so it must not leave them locked.
          ...afterSuccessfulAttempt(),
          status: 'ACTIVE',
        },
      });
      await tx.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
    });

    // Any session created before the reset is no longer trusted.
    await revokeAllUserTokens(record.firm_id, record.user_id, 'PASSWORD_RESET');

    await writeAudit({
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'user',
      entityId: record.user_id,
      firmId: record.firm_id,
      actorUserId: record.user_id,
    });

    res.status(204).send();
  }),
);

authRouter.post(
  '/password/change',
  authenticate(),
  validate(changePasswordSchema),
  handler(async (req, res) => {
    const body = valid<ChangePasswordInput>(req);
    const auth = getAuth();

    const stored = await withTenant(auth.firmId, async (tx) => {
      const row = await tx.user.findFirst({
        where: { id: auth.userId },
        select: { passwordHash: true },
      });
      return row?.passwordHash ?? null;
    });

    if (!stored || !(await verifyPassword(body.currentPassword, stored))) {
      throw badRequest('Your current password is not correct');
    }

    const passwordHash = await hashPassword(body.newPassword);
    await withTenant(auth.firmId, (tx) =>
      tx.user.update({
        where: { id: auth.userId },
        data: { passwordHash, passwordUpdatedAt: new Date() },
      }),
    );
    await revokeAllUserTokens(auth.firmId, auth.userId, 'PASSWORD_CHANGED');
    clearRefreshCookie(res);

    await writeAudit({ action: 'PASSWORD_CHANGED', entityType: 'user', entityId: auth.userId });
    res.status(204).send();
  }),
);

/* -------------------------- accept invitation -------------------------- */

authRouter.post(
  '/invitations/accept',
  rateLimits.passwordReset,
  validate(acceptInvitationSchema),
  handler(async (req, res) => {
    const body = valid<AcceptInvitationInput>(req);
    const tokenHash = createHash('sha256').update(body.token).digest('hex');

    const invitation = await findInvitation(tokenHash);

    if (
      !invitation ||
      invitation.accepted_at ||
      invitation.revoked_at ||
      new Date(invitation.expires_at).getTime() < Date.now()
    ) {
      throw badRequest('That invitation is invalid or has expired');
    }

    const existing = await findEmailOwner(invitation.email);
    if (existing && existing.firmId !== invitation.firm_id) {
      throw badRequest('That email address is already registered elsewhere');
    }

    const passwordHash = await hashPassword(body.password);
    const userId = existing?.userId ?? uuidv7();

    await withTenant(invitation.firm_id, async (tx) => {
      if (existing) {
        await tx.user.update({
          where: { id: existing.userId },
          data: {
            fullName: body.fullName,
            passwordHash,
            passwordUpdatedAt: new Date(),
            status: 'ACTIVE',
            roleId: invitation.role_id,
          },
        });
      } else {
        await tx.user.create({
          data: {
            id: userId,
            firmId: invitation.firm_id,
            email: invitation.email,
            emailNormalized: invitation.email,
            fullName: body.fullName,
            roleId: invitation.role_id,
            passwordHash,
            passwordUpdatedAt: new Date(),
            status: 'ACTIVE',
          },
        });
      }
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
    });

    await writeAudit({
      action: 'USER_ACTIVATED',
      entityType: 'user',
      entityId: userId,
      firmId: invitation.firm_id,
      actorUserId: userId,
      actorEmail: invitation.email,
    });

    res.status(204).send();
  }),
);
