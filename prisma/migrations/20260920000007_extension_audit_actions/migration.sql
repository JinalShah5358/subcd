-- Pairing a browser, capturing a form and running an autofill are all
-- consequential and belong in the audit trail. Enum values must be added in
-- their own migration before anything uses them.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EXTENSION_PAIRING_STARTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EXTENSION_DEVICE_PAIRED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EXTENSION_DEVICE_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FORM_CAPTURED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AUTOFILL_COMPLETED';
