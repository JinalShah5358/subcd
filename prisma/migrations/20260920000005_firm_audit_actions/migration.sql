-- Provisioning and suspending a firm are consequential acts and belong in the
-- audit trail like any other. Postgres will not add an enum value inside a
-- transaction block that then uses it, so these go in their own migration.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FIRM_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FIRM_STATUS_CHANGED';
