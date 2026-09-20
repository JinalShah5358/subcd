import { basePrisma } from '../db/prisma';

/**
 * Pre-authentication lookups.
 *
 * These are the only queries in the system that run before a tenant is known,
 * so they cannot go through the tenant-scoped client. They call narrowly
 * scoped SECURITY DEFINER functions instead of bypassing RLS — see
 * prisma/migrations/20260920000003_auth_functions for the reasoning.
 *
 * Every function here is keyed by a unique credential (email or token hash).
 * None of them takes a filter or can enumerate rows. Adding anything to this
 * file should be treated as a security change.
 */

export interface LoginCredentialRow {
  id: string;
  firm_id: string;
  email: string;
  password_hash: string | null;
  status: string;
  deleted_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
  role_key: string;
  role_permissions: string[];
  firm_status: string;
}

export async function findUserByEmail(emailNormalized: string): Promise<LoginCredentialRow | null> {
  const rows = await basePrisma.$queryRaw<LoginCredentialRow[]>`
    SELECT * FROM auth_find_user_by_email(${emailNormalized})
  `;
  return rows[0] ?? null;
}

export interface SessionSubjectRow {
  id: string;
  firm_id: string;
  email: string;
  status: string;
  deleted_at: Date | null;
  role_key: string;
  role_permissions: string[];
  firm_status: string;
}

export async function findUserById(id: string): Promise<SessionSubjectRow | null> {
  const rows = await basePrisma.$queryRaw<SessionSubjectRow[]>`
    SELECT * FROM auth_find_user_by_id(${id}::uuid)
  `;
  return rows[0] ?? null;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  firm_id: string;
  family_id: string;
  client_type: string;
  used_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date;
  user_status: string;
  user_deleted: Date | null;
}

export async function findRefreshToken(tokenHash: string): Promise<RefreshTokenRow | null> {
  const rows = await basePrisma.$queryRaw<RefreshTokenRow[]>`
    SELECT * FROM auth_find_refresh_token(${tokenHash})
  `;
  return rows[0] ?? null;
}

export interface ResetTokenRow {
  id: string;
  user_id: string;
  firm_id: string;
  used_at: Date | null;
  expires_at: Date;
}

export async function findResetToken(tokenHash: string): Promise<ResetTokenRow | null> {
  const rows = await basePrisma.$queryRaw<ResetTokenRow[]>`
    SELECT * FROM auth_find_reset_token(${tokenHash})
  `;
  return rows[0] ?? null;
}

export interface InvitationRow {
  id: string;
  firm_id: string;
  email: string;
  full_name: string;
  role_id: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

export async function findInvitation(tokenHash: string): Promise<InvitationRow | null> {
  const rows = await basePrisma.$queryRaw<InvitationRow[]>`
    SELECT * FROM auth_find_invitation(${tokenHash})
  `;
  return rows[0] ?? null;
}

/** Enforces one-firm-per-user (ADR-004) without exposing the other firm's data. */
export async function findEmailOwner(
  emailNormalized: string,
): Promise<{ userId: string; firmId: string } | null> {
  const rows = await basePrisma.$queryRaw<Array<{ user_id: string; firm_id: string }>>`
    SELECT * FROM auth_email_owner(${emailNormalized})
  `;
  const row = rows[0];
  return row ? { userId: row.user_id, firmId: row.firm_id } : null;
}
