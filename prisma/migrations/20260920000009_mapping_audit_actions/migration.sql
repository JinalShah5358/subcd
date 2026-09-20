-- Binding a form control to a data path, and activating a capture, are both
-- decisions a person made and both belong in the trail.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FORM_VERSION_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FIELD_MAPPED';
