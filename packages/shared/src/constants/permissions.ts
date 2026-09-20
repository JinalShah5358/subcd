/**
 * MVP permission strings. Deliberately short — see ADR: "do not over-engineer
 * permissions for the MVP, but leave a clean path for RBAC expansion".
 * The UI uses these to hide affordances; the API re-checks every one of them.
 */
export const PERMISSIONS = [
  'client:read',
  'client:write',
  'case:read',
  'case:write',
  'case:transition',
  'document:read',
  'document:write',
  'sensitive:reveal',
  'consent:record',
  'validation:run',
  'validation:waive',
  'user:manage',
  'firm:manage',
  'audit:read',
  'platform:admin',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_KEYS = [
  'PLATFORM_ADMIN',
  'FIRM_ADMIN',
  'CA',
  'STAFF',
  'REVIEWER',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABEL: Record<RoleKey, string> = {
  PLATFORM_ADMIN: 'Platform administrator',
  FIRM_ADMIN: 'Firm admin',
  CA: 'Chartered Accountant',
  STAFF: 'Staff',
  REVIEWER: 'Reviewer',
};

/**
 * Role -> permission bundles. Seeded into the Role table; the database is the
 * runtime source of truth, this object is the seed definition and the test oracle.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  /**
   * One permission, and it is not a superset of the others.
   *
   * A platform administrator runs the service: they provision firms, set
   * licences, suspend and restore. They have no business reading a client, a
   * case, a document or an audit trail — in any firm, including the tenant
   * their own account sits in. Row Level Security would return them nothing
   * anyway, but "the query comes back empty" is a second line of defence, not
   * a reason to hand out the permission in the first place.
   *
   * The practical effect: every firm-facing route answers a platform admin
   * with 403 rather than with an empty list.
   */
  PLATFORM_ADMIN: ['platform:admin'],

  FIRM_ADMIN: [
    'client:read',
    'client:write',
    'case:read',
    'case:write',
    'case:transition',
    'document:read',
    'document:write',
    'sensitive:reveal',
    'consent:record',
    'validation:run',
    'validation:waive',
    'user:manage',
    'firm:manage',
    'audit:read',
  ],

  CA: [
    'client:read',
    'client:write',
    'case:read',
    'case:write',
    'case:transition',
    'document:read',
    'document:write',
    'sensitive:reveal',
    'consent:record',
    'validation:run',
    'validation:waive',
  ],

  // Staff do data entry. They cannot reveal identifiers, record consent,
  // waive findings, or move a case forward for filing.
  STAFF: [
    'client:read',
    'client:write',
    'case:read',
    'case:write',
    'document:read',
    'document:write',
    'validation:run',
  ],

  // Reviewers look, run validation, and read the audit trail. No writes.
  REVIEWER: [
    'client:read',
    'case:read',
    'document:read',
    'validation:run',
    'audit:read',
  ],
};

export const ROLE_RANK: Record<RoleKey, number> = {
  PLATFORM_ADMIN: 100,
  FIRM_ADMIN: 80,
  CA: 60,
  REVIEWER: 40,
  STAFF: 20,
};

/** Roles a FIRM_ADMIN may assign within their own firm. */
export const ASSIGNABLE_ROLE_KEYS: RoleKey[] = ['FIRM_ADMIN', 'CA', 'STAFF', 'REVIEWER'];

/**
 * Is this permission granted?
 *
 * `platform:admin` used to act as a wildcard here, which made it a global
 * superuser flag: one role that satisfied every check in the application, on
 * every route, for every firm. That is the opposite of what the platform role
 * is for, and it meant the only thing standing between a platform
 * administrator and a client record was the database. There is no wildcard
 * now — a permission is granted when it was granted.
 */
export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(required);
}

export function hasAllPermissions(
  granted: readonly string[],
  required: readonly Permission[],
): boolean {
  return required.every((p) => hasPermission(granted, p));
}
