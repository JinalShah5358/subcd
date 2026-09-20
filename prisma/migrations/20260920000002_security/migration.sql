-- ---------------------------------------------------------------------------
-- Security layer: everything Prisma cannot express.
--   1. Extensions
--   2. Partial unique indexes
--   3. Trigram search indexes
--   4. CHECK constraints (structural sanity only — never scheme policy)
--   5. The Aadhaar full-number block (ADR-013)
--   6. Grants: audit_log is INSERT/SELECT only; catalog tables are read-only
--   7. Row Level Security on every tenant-owned table
--
-- NOTE on FORCE ROW LEVEL SECURITY: policies are ENABLEd but not FORCEd, so the
-- table owner (ifp_owner — migrations and seed only) can still write. The
-- application connects as ifp_app, which is NOBYPASSRLS and is not the owner,
-- so every application query is subject to the policies below. The API asserts
-- at boot that it is NOT connected as the owner (see assertRlsActive()).
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================ 2. PARTIAL UNIQUE ============================
-- Postgres treats NULLs as distinct in a composite unique index, so the
-- Prisma-level @@unique([firmId, key]) does not stop duplicate SYSTEM rows.

CREATE UNIQUE INDEX IF NOT EXISTS role_system_key_uq
  ON "role" (key) WHERE firm_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS document_type_global_code_uq
  ON "document_type" (code) WHERE firm_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS client_promoter_primary_uq
  ON "client_promoter" (client_id) WHERE is_primary;

-- One open (non-withdrawn) consent per case.
CREATE UNIQUE INDEX IF NOT EXISTS consent_record_active_case_uq
  ON "consent_record" (case_id) WHERE status = 'RECORDED' AND case_id IS NOT NULL;

-- ============================ 3. SEARCH INDEXES ============================

CREATE INDEX IF NOT EXISTS client_legal_name_trgm
  ON "client" USING gin (legal_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS client_trade_name_trgm
  ON "client" USING gin (trade_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS bank_search_trgm
  ON "bank" USING gin ((name || ' ' || branch_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS case_number_trgm
  ON "case" USING gin (case_number gin_trgm_ops);

-- ============================ 4. CHECK CONSTRAINTS =========================

ALTER TABLE "client_promoter"
  DROP CONSTRAINT IF EXISTS promoter_ownership_pct_range,
  ADD  CONSTRAINT promoter_ownership_pct_range
  CHECK (ownership_percent IS NULL OR (ownership_percent >= 0 AND ownership_percent <= 100));

ALTER TABLE "employment"
  DROP CONSTRAINT IF EXISTS employment_counts_nonneg,
  ADD  CONSTRAINT employment_counts_nonneg
  CHECK (
    COALESCE(total_employees, 0)           >= 0 AND
    COALESCE(epf_registered_employees, 0)  >= 0 AND
    COALESCE(local_employees, 0)           >= 0 AND
    COALESCE(skilled_count, 0)             >= 0 AND
    COALESCE(semi_skilled_count, 0)        >= 0 AND
    COALESCE(unskilled_count, 0)           >= 0 AND
    COALESCE(male_count, 0)                >= 0 AND
    COALESCE(female_count, 0)              >= 0 AND
    COALESCE(differently_abled_count, 0)   >= 0 AND
    COALESCE(contract_employees, 0)        >= 0 AND
    COALESCE(employment_generated_new, 0)  >= 0
  );

ALTER TABLE "investment"
  DROP CONSTRAINT IF EXISTS investment_amounts_nonneg,
  ADD  CONSTRAINT investment_amounts_nonneg
  CHECK (
    COALESCE(land_cost, 0)                    >= 0 AND
    COALESCE(land_development_cost, 0)        >= 0 AND
    COALESCE(building_cost, 0)                >= 0 AND
    COALESCE(plant_machinery_cost, 0)         >= 0 AND
    COALESCE(electrical_installation_cost, 0) >= 0 AND
    COALESCE(equipment_cost, 0)               >= 0 AND
    COALESCE(furniture_fixture_cost, 0)       >= 0 AND
    COALESCE(other_eligible_cost, 0)          >= 0 AND
    COALESCE(pre_operative_expenses, 0)       >= 0 AND
    COALESCE(total_project_cost, 0)           >= 0 AND
    COALESCE(promoter_contribution, 0)        >= 0 AND
    COALESCE(term_loan_component, 0)          >= 0 AND
    COALESCE(subsidy_claimed_amount, 0)       >= 0
  );

ALTER TABLE "loan"
  DROP CONSTRAINT IF EXISTS loan_amounts_nonneg,
  ADD  CONSTRAINT loan_amounts_nonneg
  CHECK (
    COALESCE(sanctioned_amount, 0) >= 0 AND
    COALESCE(disbursed_amount, 0)  >= 0 AND
    COALESCE(tenure_months, 0)     >= 0 AND
    COALESCE(moratorium_months, 0) >= 0
  );

ALTER TABLE "case"
  DROP CONSTRAINT IF EXISTS case_readiness_range,
  ADD  CONSTRAINT case_readiness_range
  CHECK (readiness_score >= 0 AND readiness_score <= 100);

-- ======================== 5. THE AADHAAR BLOCK (ADR-013) ===================
-- Full Aadhaar numbers cannot be stored. Enabling this is a deliberate,
-- reviewed migration that drops this constraint — never a code-level flag.

ALTER TABLE "client_promoter"
  DROP CONSTRAINT IF EXISTS promoter_aadhaar_full_storage_blocked,
  ADD  CONSTRAINT promoter_aadhaar_full_storage_blocked
  CHECK (aadhaar_ref_enc IS NULL);

COMMENT ON CONSTRAINT promoter_aadhaar_full_storage_blocked ON "client_promoter" IS
  'ADR-013: full Aadhaar storage is blocked pending a documented legal decision (task XC-002). Do not drop without that decision.';

-- ============================== 6. GRANTS ==================================

-- Audit log is append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM ifp_app;
GRANT  INSERT, SELECT ON "audit_log" TO ifp_app;

-- Platform catalog is read-only for the application role. Scheme versions,
-- rules and consent templates are changed by a privileged operator process.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  "district", "taluka", "scheme", "scheme_version", "scheme_document_requirement",
  "validation_rule", "validation_rule_version", "consent_template"
  FROM ifp_app;
GRANT SELECT ON
  "district", "taluka", "scheme", "scheme_version", "scheme_document_requirement",
  "validation_rule", "validation_rule_version", "consent_template"
  TO ifp_app;

-- ============================ 7. ROW LEVEL SECURITY ========================

CREATE OR REPLACE FUNCTION app_current_firm_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.firm_id', true), '')::uuid
$$;

COMMENT ON FUNCTION app_current_firm_id() IS
  'Reads the transaction-local tenant id set by withTenant(). Returns NULL when unset, which makes every RLS policy fail closed.';

-- Strictly tenant-owned tables: firm_id must match the session tenant.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_user','invitation','refresh_token','password_reset_token',
    'client','client_promoter','case','project','loan','employment',
    'investment','first_sale','case_document','case_validation_run',
    'case_validation_finding','consent_record','audit_log'
  ]
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

-- Hybrid tables: global rows (firm_id IS NULL) are readable by everyone,
-- firm rows only by their owner. Writes always require the tenant to match.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['role','bank','document_type']
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

-- The firm row itself: a tenant sees only its own.
ALTER TABLE "firm" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firm_self_isolation ON "firm";
CREATE POLICY firm_self_isolation ON "firm"
  USING (id = app_current_firm_id())
  WITH CHECK (id = app_current_firm_id());
