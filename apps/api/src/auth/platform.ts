import { basePrisma } from '../db/prisma';

/**
 * The platform's cross-tenant reads, and its two cross-tenant writes:
 * provisioning a firm, and setting its licence.
 *
 * Every function here calls a SECURITY DEFINER routine defined in
 * `20260920000004_platform_functions` or `20260920000010_licensing`. Those
 * migrations are the security boundary; this file is the typed doorway to
 * them, and exists so the raw SQL appears exactly once and every caller is
 * greppable.
 *
 * What these can return is fixed by the functions' return types: firm
 * metadata and counts. There is no function here that can return a client, a
 * case, an identifier or a document, so a platform administrator cannot read
 * one however the API is called.
 */

export interface PlatformFirmRow {
  id: string;
  name: string;
  slug: string;
  frn: string | null;
  status: string;
  data_region: string;
  contact_email: string | null;
  created_at: Date;
  plan: string;
  license_expires_at: Date | null;
  license_grace_days: number;
  max_users: number | null;
  max_clients: number | null;
  max_cases: number | null;
  user_count: bigint;
  client_count: bigint;
  case_count: bigint;
  last_active_at: Date | null;
  total_count: bigint;
}

export interface PlatformFirmDetailRow {
  id: string;
  name: string;
  slug: string;
  frn: string | null;
  gstin: string | null;
  status: string;
  data_region: string;
  retention_months: number;
  contact_email: string | null;
  contact_phone: string | null;
  city: string | null;
  state: string | null;
  created_at: Date;
  plan: string;
  license_expires_at: Date | null;
  license_grace_days: number;
  max_users: number | null;
  max_clients: number | null;
  max_cases: number | null;
  license_note: string | null;
  license_updated_at: Date | null;
  user_count: bigint;
  active_user_count: bigint;
  client_count: bigint;
  case_count: bigint;
  last_active_at: Date | null;
}

export async function listFirms(args: {
  search?: string | undefined;
  status?: string | undefined;
  limit: number;
  offset: number;
}): Promise<PlatformFirmRow[]> {
  return basePrisma.$queryRaw<PlatformFirmRow[]>`
    SELECT * FROM platform_list_firms(
      ${args.search ?? null}::text,
      ${args.status ?? null}::text,
      ${args.limit}::integer,
      ${args.offset}::integer
    )
  `;
}

export async function firmDetail(id: string): Promise<PlatformFirmDetailRow | null> {
  const rows = await basePrisma.$queryRaw<PlatformFirmDetailRow[]>`
    SELECT * FROM platform_firm_detail(${id}::uuid)
  `;
  return rows[0] ?? null;
}

export async function slugTaken(slug: string): Promise<boolean> {
  const rows = await basePrisma.$queryRaw<Array<{ platform_slug_taken: boolean }>>`
    SELECT platform_slug_taken(${slug}::text)
  `;
  return rows[0]?.platform_slug_taken ?? false;
}

export async function createFirm(args: {
  id: string;
  name: string;
  slug: string;
  frn?: string | null;
  contactEmail?: string | null;
  city?: string | null;
  state?: string | null;
  dataRegion: string;
  plan: string;
  /** Date-only 'YYYY-MM-DD', or null for a licence with no end date. */
  expiresAt: string | null;
  graceDays: number;
  maxUsers: number | null;
  maxClients: number | null;
  maxCases: number | null;
  licenseNote?: string | null;
}): Promise<string> {
  const rows = await basePrisma.$queryRaw<Array<{ platform_create_firm: string }>>`
    SELECT platform_create_firm(
      ${args.id}::uuid,
      ${args.name}::text,
      ${args.slug}::text,
      ${args.frn ?? null}::text,
      ${args.contactEmail ?? null}::text,
      ${args.city ?? null}::text,
      ${args.state ?? null}::text,
      ${args.dataRegion}::text,
      ${args.plan}::text,
      ${args.expiresAt}::date,
      ${args.graceDays}::integer,
      ${args.maxUsers}::integer,
      ${args.maxClients}::integer,
      ${args.maxCases}::integer,
      ${args.licenseNote ?? null}::text
    )
  `;
  const id = rows[0]?.platform_create_firm;
  if (!id) throw new Error('platform_create_firm returned no id');
  return id;
}

export async function setFirmStatus(
  id: string,
  status: string,
): Promise<{ id: string; name: string; status: string } | null> {
  const rows = await basePrisma.$queryRaw<Array<{ id: string; name: string; status: string }>>`
    SELECT * FROM platform_set_firm_status(${id}::uuid, ${status}::text)
  `;
  return rows[0] ?? null;
}

export interface PlatformTotals {
  firm_count: bigint;
  active_firms: bigint;
  suspended_firms: bigint;
  user_count: bigint;
  client_count: bigint;
  case_count: bigint;
}

export async function totals(): Promise<PlatformTotals> {
  const rows = await basePrisma.$queryRaw<PlatformTotals[]>`SELECT * FROM platform_totals()`;
  return (
    rows[0] ?? {
      firm_count: 0n,
      active_firms: 0n,
      suspended_firms: 0n,
      user_count: 0n,
      client_count: 0n,
      case_count: 0n,
    }
  );
}

/* ------------------------------- licensing ------------------------------- */

export interface PlatformLicenseRow {
  id: string;
  name: string;
  plan: string;
  license_expires_at: Date | null;
  license_grace_days: number;
  max_users: number | null;
  max_clients: number | null;
  max_cases: number | null;
  license_note: string | null;
  license_updated_at: Date | null;
}

/**
 * Set or renew a firm's licence.
 *
 * The second and last cross-tenant write in the system. Like the first it
 * touches the firm row and nothing else — there is no tenant data reachable
 * from here, by construction rather than by care.
 */
export async function setFirmLicense(args: {
  id: string;
  plan: string;
  /** Date-only 'YYYY-MM-DD', or null for a licence with no end date. */
  expiresAt: string | null;
  graceDays: number;
  maxUsers: number | null;
  maxClients: number | null;
  maxCases: number | null;
  note: string | null;
}): Promise<PlatformLicenseRow | null> {
  const rows = await basePrisma.$queryRaw<PlatformLicenseRow[]>`
    SELECT * FROM platform_set_firm_license(
      ${args.id}::uuid,
      ${args.plan}::text,
      ${args.expiresAt}::date,
      ${args.graceDays}::integer,
      ${args.maxUsers}::integer,
      ${args.maxClients}::integer,
      ${args.maxCases}::integer,
      ${args.note}::text
    )
  `;
  return rows[0] ?? null;
}

export interface PlatformExpiringRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  contact_email: string | null;
  plan: string;
  license_expires_at: Date;
  license_grace_days: number;
  total_count: bigint;
}

/** Licences that have ended or are about to. Expired first, then soonest. */
export async function listExpiring(args: {
  withinDays: number;
  limit: number;
  offset: number;
}): Promise<PlatformExpiringRow[]> {
  return basePrisma.$queryRaw<PlatformExpiringRow[]>`
    SELECT * FROM platform_list_expiring(
      ${args.withinDays}::integer,
      ${args.limit}::integer,
      ${args.offset}::integer
    )
  `;
}
