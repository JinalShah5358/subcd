-- Setting or renewing a licence changes what a firm is allowed to do, so it
-- belongs in the audit trail. Postgres will not add an enum value inside a
-- transaction block that then uses it, so it goes in its own migration.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FIRM_LICENSE_CHANGED';
