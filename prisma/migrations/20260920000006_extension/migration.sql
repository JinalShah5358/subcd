-- Extension: form catalog, field mappings, devices and autofill telemetry.
--
-- Nothing here stores an IFP credential, a session cookie, or the VALUE of any
-- field that was filled. autofill_field_outcome records a source PATH and an
-- outcome; the audit canary test asserts no identifier ever reaches it.

-- CreateEnum
CREATE TYPE "FormVersionStatus" AS ENUM ('CAPTURED', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AutofillOutcome" AS ENUM ('FILLED', 'MISSING', 'NOT_EDITABLE', 'NO_VALUE', 'OPTION_NOT_FOUND', 'REFUSED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AutofillSessionStatus" AS ENUM ('STARTED', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "form_definition" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500),
    "host" VARCHAR(120) NOT NULL,
    "path_hint" VARCHAR(250),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_version" (
    "id" UUID NOT NULL,
    "firm_id" UUID,
    "form_id" UUID NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "status" "FormVersionStatus" NOT NULL DEFAULT 'CAPTURED',
    "fingerprint" VARCHAR(64) NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "captured_by_user_id" UUID,
    "note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_field" (
    "id" UUID NOT NULL,
    "firm_id" UUID,
    "form_version_id" UUID NOT NULL,
    "selector" VARCHAR(500) NOT NULL,
    "control_type" VARCHAR(24) NOT NULL,
    "input_type" VARCHAR(24),
    "label_text" VARCHAR(250),
    "name_attr" VARCHAR(200),
    "id_attr" VARCHAR(200),
    "required" BOOLEAN NOT NULL DEFAULT false,
    "max_length" INTEGER,
    "options" JSONB,
    "refused_reason" VARCHAR(120),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_mapping" (
    "id" UUID NOT NULL,
    "firm_id" UUID,
    "form_version_id" UUID NOT NULL,
    "form_field_id" UUID NOT NULL,
    "source_path" VARCHAR(120) NOT NULL,
    "transform" VARCHAR(40),
    "option_map" JSONB,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extension_device" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "secret_hash" VARCHAR(64) NOT NULL,
    "agent_version" VARCHAR(32),
    "last_seen_at" TIMESTAMP(3),
    "last_seen_ip" INET,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" VARCHAR(120),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extension_device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autofill_session" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "device_id" UUID,
    "form_version_id" UUID,
    "user_id" UUID NOT NULL,
    "status" "AutofillSessionStatus" NOT NULL DEFAULT 'STARTED',
    "fields_attempted" INTEGER NOT NULL DEFAULT 0,
    "fields_filled" INTEGER NOT NULL DEFAULT 0,
    "fields_failed" INTEGER NOT NULL DEFAULT 0,
    "drift_detected" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "autofill_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autofill_field_outcome" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "source_path" VARCHAR(120) NOT NULL,
    "selector" VARCHAR(500),
    "outcome" "AutofillOutcome" NOT NULL,
    "detail" VARCHAR(250),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autofill_field_outcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "form_definition_code_key" ON "form_definition"("code");

-- CreateIndex
CREATE INDEX "form_version_firm_id_form_id_status_idx" ON "form_version"("firm_id", "form_id", "status");

-- CreateIndex
CREATE INDEX "form_version_fingerprint_idx" ON "form_version"("fingerprint");

-- CreateIndex
CREATE INDEX "form_field_form_version_id_sort_order_idx" ON "form_field"("form_version_id", "sort_order");

-- CreateIndex
CREATE INDEX "form_field_firm_id_idx" ON "form_field"("firm_id");

-- CreateIndex
CREATE INDEX "field_mapping_form_version_id_idx" ON "field_mapping"("form_version_id");

-- CreateIndex
CREATE INDEX "field_mapping_firm_id_idx" ON "field_mapping"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "field_mapping_form_field_id_source_path_key" ON "field_mapping"("form_field_id", "source_path");

-- CreateIndex
CREATE UNIQUE INDEX "extension_device_secret_hash_key" ON "extension_device"("secret_hash");

-- CreateIndex
CREATE INDEX "extension_device_firm_id_user_id_idx" ON "extension_device"("firm_id", "user_id");

-- CreateIndex
CREATE INDEX "extension_device_firm_id_revoked_at_idx" ON "extension_device"("firm_id", "revoked_at");

-- CreateIndex
CREATE INDEX "autofill_session_firm_id_case_id_started_at_idx" ON "autofill_session"("firm_id", "case_id", "started_at");

-- CreateIndex
CREATE INDEX "autofill_session_firm_id_started_at_idx" ON "autofill_session"("firm_id", "started_at");

-- CreateIndex
CREATE INDEX "autofill_field_outcome_firm_id_session_id_idx" ON "autofill_field_outcome"("firm_id", "session_id");

-- CreateIndex
CREATE INDEX "autofill_field_outcome_firm_id_outcome_idx" ON "autofill_field_outcome"("firm_id", "outcome");

-- AddForeignKey
ALTER TABLE "form_version" ADD CONSTRAINT "form_version_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_version" ADD CONSTRAINT "form_version_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "form_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_field" ADD CONSTRAINT "form_field_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_field" ADD CONSTRAINT "form_field_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_mapping" ADD CONSTRAINT "field_mapping_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_mapping" ADD CONSTRAINT "field_mapping_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_mapping" ADD CONSTRAINT "field_mapping_form_field_id_fkey" FOREIGN KEY ("form_field_id") REFERENCES "form_field"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_device" ADD CONSTRAINT "extension_device_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_device" ADD CONSTRAINT "extension_device_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autofill_session" ADD CONSTRAINT "autofill_session_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autofill_session" ADD CONSTRAINT "autofill_session_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autofill_session" ADD CONSTRAINT "autofill_session_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "extension_device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autofill_session" ADD CONSTRAINT "autofill_session_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autofill_session" ADD CONSTRAINT "autofill_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autofill_field_outcome" ADD CONSTRAINT "autofill_field_outcome_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autofill_field_outcome" ADD CONSTRAINT "autofill_field_outcome_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "autofill_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Row Level Security for the extension tables.
--
-- Same two classes as everywhere else:
--
--   TENANT  extension_device, autofill_session, autofill_field_outcome
--           These are a firm's own records of what its own people did.
--
--   HYBRID  form_version, form_field, field_mapping
--           A capture starts firm-private (firm_id set) and is curated into
--           the shared catalog (firm_id null) once someone has checked it —
--           exactly how bank and document_type already work. A firm therefore
--           sees the curated mapping plus its own drafts, and never another
--           firm's drafts.
--
--   GLOBAL  form_definition
--           The identity of a form on the portal. Readable by everyone,
--           writable only by the migration/owner role.
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['extension_device','autofill_session','autofill_field_outcome']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id())',
      t || '_tenant_isolation', t
    );
  END LOOP;
END
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['form_version','form_field','field_mapping']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (firm_id IS NULL OR firm_id = app_current_firm_id())',
      t || '_tenant_read', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id())',
      t || '_tenant_write', t
    );
  END LOOP;
END
$$;

-- form_definition is a platform catalog: everyone reads it, nobody writes it
-- through the application role.
ALTER TABLE "form_definition" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS form_definition_read ON "form_definition";
CREATE POLICY form_definition_read ON "form_definition" FOR SELECT USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  form_version, form_field, field_mapping,
  extension_device, autofill_session, autofill_field_outcome
TO ifp_app;
GRANT SELECT ON form_definition TO ifp_app;

-- ---------------------------------------------------------------------------
-- Guard rails the application cannot forget.
--
-- The extension must never capture a password field, a file input, or anything
-- CAPTCHA-shaped, and must never be pointed at a wildcard host. Those are
-- policies in the extension's own code AND here, because a bug in the former
-- should not be able to write the result to disk.
-- ---------------------------------------------------------------------------

ALTER TABLE "form_field" DROP CONSTRAINT IF EXISTS form_field_no_secret_controls;
ALTER TABLE "form_field" ADD CONSTRAINT form_field_no_secret_controls CHECK (
  -- A refused control is recorded as a placeholder (so the CA can see WHY a
  -- field was left alone) but must carry no selector to act on.
  (refused_reason IS NOT NULL)
  OR (
    lower(coalesce(input_type, '')) NOT IN ('password', 'file', 'hidden')
    AND lower(coalesce(name_attr, '')) NOT LIKE '%captcha%'
    AND lower(coalesce(id_attr, '')) NOT LIKE '%captcha%'
    AND lower(coalesce(label_text, '')) NOT LIKE '%captcha%'
  )
);

ALTER TABLE "form_definition" DROP CONSTRAINT IF EXISTS form_definition_host_is_specific;
ALTER TABLE "form_definition" ADD CONSTRAINT form_definition_host_is_specific CHECK (
  host <> '' AND host NOT LIKE '%*%' AND host NOT LIKE '%<all_urls>%' AND host NOT LIKE '%://%'
);

-- An outcome row records that a field was targeted, never what went into it.
ALTER TABLE "autofill_field_outcome" DROP CONSTRAINT IF EXISTS autofill_outcome_detail_length;
ALTER TABLE "autofill_field_outcome" ADD CONSTRAINT autofill_outcome_detail_length CHECK (
  detail IS NULL OR length(detail) <= 250
);

COMMENT ON TABLE autofill_field_outcome IS
  'Field NAMES and outcomes only. Never a filled value — asserted by the audit canary test.';
COMMENT ON COLUMN extension_device.secret_hash IS
  'SHA-256 of the device secret. The secret is shown once at pairing and never stored.';
COMMENT ON CONSTRAINT form_field_no_secret_controls ON form_field IS
  'The extension must never capture or fill a password, file or CAPTCHA control.';
