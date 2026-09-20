-- CreateEnum
CREATE TYPE "FirmStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PVT_LTD', 'PUBLIC_LTD', 'HUF', 'TRUST', 'SOCIETY', 'COOP', 'OTHER');

-- CreateEnum
CREATE TYPE "PromoterRole" AS ENUM ('PROPRIETOR', 'PARTNER', 'DIRECTOR', 'TRUSTEE', 'MEMBER', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicationType" AS ENUM ('CAPITAL_SUBSIDY', 'INTEREST_SUBSIDY', 'PROVISIONAL_ELIGIBILITY', 'FINAL_ELIGIBILITY');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'READY_TO_FILE', 'FILED', 'ACKNOWLEDGED', 'QUERY_RAISED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AreaType" AS ENUM ('URBAN', 'RURAL', 'MUNICIPAL', 'GIDC', 'OTHER');

-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('FIXED', 'FLOATING');

-- CreateEnum
CREATE TYPE "BankType" AS ENUM ('PSU', 'PRIVATE', 'COOP', 'RRB', 'NBFC', 'SFB', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('ENTITY', 'PROMOTER', 'PROJECT', 'FINANCE', 'EMPLOYMENT', 'SALES', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentSlotStatus" AS ENUM ('REQUIRED', 'PRESENT', 'NOT_AVAILABLE', 'NOT_APPLICABLE', 'REJECTED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'QUERY');

-- CreateEnum
CREATE TYPE "SchemeVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RuleSeverity" AS ENUM ('BLOCKING', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "RuleCategory" AS ENUM ('FORMAT', 'REQUIRED', 'DATE_WINDOW', 'CONSISTENCY', 'RATIO', 'DUPLICATE', 'DOCUMENT', 'CROSS_FIELD');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "RuleAppliesTo" AS ENUM ('CASE', 'CLIENT', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "ValidationTrigger" AS ENUM ('MANUAL', 'ON_SAVE', 'PRE_AUTOFILL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'WAIVED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('RECORDED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('CA_ATTESTATION', 'SIGNED_DOCUMENT', 'EMAIL_CONFIRMATION');

-- CreateEnum
CREATE TYPE "ClientAppType" AS ENUM ('WEB', 'EXTENSION', 'SYSTEM', 'CLI');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REFRESHED', 'TOKEN_REUSE_DETECTED', 'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'USER_INVITED', 'USER_ACTIVATED', 'USER_UPDATED', 'USER_DISABLED', 'ROLE_CHANGED', 'FIRM_UPDATED', 'CLIENT_CREATED', 'CLIENT_UPDATED', 'CLIENT_DELETED', 'PROMOTER_CREATED', 'PROMOTER_UPDATED', 'PROMOTER_DELETED', 'CASE_CREATED', 'CASE_UPDATED', 'CASE_STATUS_CHANGED', 'CASE_DELETED', 'CASE_SECTION_UPDATED', 'SENSITIVE_DATA_VIEWED', 'SENSITIVE_FIELD_REVEALED', 'DOCUMENT_SLOT_UPDATED', 'DATA_EXPORTED', 'VALIDATION_RUN', 'VALIDATION_WAIVED', 'CONSENT_RECORDED', 'CONSENT_WITHDRAWN', 'RULE_VERSION_PUBLISHED', 'RETENTION_PURGE_EXECUTED', 'ACCESS_DENIED');

-- CreateTable
CREATE TABLE "firm" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "frn" VARCHAR(32),
    "gstin" VARCHAR(15),
    "contact_email" VARCHAR(254),
    "contact_phone" VARCHAR(20),
    "address_line1" VARCHAR(200),
    "address_line2" VARCHAR(200),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "pincode" VARCHAR(6),
    "status" "FirmStatus" NOT NULL DEFAULT 'ACTIVE',
    "data_region" VARCHAR(16) NOT NULL DEFAULT 'in-west',
    "retention_months" INTEGER NOT NULL DEFAULT 96,
    "wrapped_dek" BYTEA,
    "dek_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "firm_id" UUID,
    "key" VARCHAR(32) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(250),
    "permissions" TEXT[],
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "email_normalized" VARCHAR(254) NOT NULL,
    "password_hash" TEXT,
    "password_updated_at" TIMESTAMP(3),
    "full_name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(20),
    "role_id" UUID NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_enc" BYTEA,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" INET,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "role_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "invited_by_user_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "client_type" "ClientAppType" NOT NULL DEFAULT 'WEB',
    "user_agent_hash" VARCHAR(64),
    "ip_at_issue" INET,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" VARCHAR(120),

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_token" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "request_ip" INET,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "district" (
    "id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "state_code" VARCHAR(4) NOT NULL DEFAULT 'GJ',
    "dic_code" VARCHAR(12),
    "dic_name" VARCHAR(160),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "district_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taluka" (
    "id" UUID NOT NULL,
    "district_id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "taluka_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank" (
    "id" UUID NOT NULL,
    "firm_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "branch_name" VARCHAR(160) NOT NULL,
    "ifsc" VARCHAR(11),
    "bank_type" "BankType",
    "city" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_type" (
    "id" UUID NOT NULL,
    "firm_id" UUID,
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(400),
    "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER',
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme" (
    "id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "authority" VARCHAR(200),
    "description" VARCHAR(1000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_version" (
    "id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "version_label" VARCHAR(32) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "source_reference" VARCHAR(250),
    "source_url" VARCHAR(500),
    "status" "SchemeVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheme_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_document_requirement" (
    "id" UUID NOT NULL,
    "scheme_version_id" UUID NOT NULL,
    "document_type_id" UUID NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "applies_when_expr" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheme_document_requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "legal_name" VARCHAR(250) NOT NULL,
    "trade_name" VARCHAR(250),
    "entity_type" "EntityType" NOT NULL,
    "constitution_note" VARCHAR(250),
    "business_activity" VARCHAR(250),
    "nic_code" VARCHAR(12),
    "pan_enc" BYTEA,
    "pan_last4" VARCHAR(4),
    "pan_blind_index" BYTEA,
    "gstin_enc" BYTEA,
    "gstin_last4" VARCHAR(4),
    "gstin_blind_index" BYTEA,
    "udyam_enc" BYTEA,
    "udyam_last4" VARCHAR(4),
    "incorporation_date" DATE,
    "regd_address_line1" VARCHAR(200),
    "regd_address_line2" VARCHAR(200),
    "regd_city" VARCHAR(100),
    "regd_district_code" VARCHAR(12),
    "regd_pincode" VARCHAR(6),
    "contact_person_name" VARCHAR(160),
    "contact_email" VARCHAR(254),
    "contact_phone" VARCHAR(20),
    "notes" VARCHAR(2000),
    "deleted_at" TIMESTAMP(3),
    "deleted_by_user_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_promoter" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "designation" "PromoterRole" NOT NULL,
    "ownership_percent" DECIMAL(5,2),
    "pan_enc" BYTEA,
    "pan_last4" VARCHAR(4),
    "pan_blind_index" BYTEA,
    "aadhaar_last4" VARCHAR(4),
    "aadhaar_ref_enc" BYTEA,
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "date_of_birth" DATE,
    "address_line1" VARCHAR(200),
    "city" VARCHAR(100),
    "pincode" VARCHAR(6),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_promoter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "scheme_version_id" UUID NOT NULL,
    "case_number" VARCHAR(32) NOT NULL,
    "title" VARCHAR(200),
    "application_type" "ApplicationType" NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
    "application_date" DATE,
    "portal_application_no" VARCHAR(64),
    "filed_at" TIMESTAMP(3),
    "filed_by_user_id" UUID,
    "readiness_score" INTEGER NOT NULL DEFAULT 0,
    "last_validation_run_id" UUID,
    "assigned_to_user_id" UUID,
    "duplicate_override_reason" VARCHAR(500),
    "status_reason" VARCHAR(500),
    "deleted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "project_name" VARCHAR(250),
    "address_line1" VARCHAR(200),
    "address_line2" VARCHAR(200),
    "village" VARCHAR(120),
    "taluka_code" VARCHAR(12),
    "district_code" VARCHAR(12),
    "dic_code" VARCHAR(12),
    "pincode" VARCHAR(6),
    "gidc_estate" VARCHAR(120),
    "plot_survey_no" VARCHAR(80),
    "area_type" "AreaType",
    "is_expansion" BOOLEAN NOT NULL DEFAULT false,
    "commercial_production_date" DATE,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "bank_id" UUID,
    "loan_account_enc" BYTEA,
    "loan_account_last4" VARCHAR(4),
    "loan_account_blind_index" BYTEA,
    "sanction_letter_ref" VARCHAR(80),
    "sanction_date" DATE,
    "first_disbursement_date" DATE,
    "last_disbursement_date" DATE,
    "sanctioned_amount" DECIMAL(16,2),
    "disbursed_amount" DECIMAL(16,2),
    "interest_rate_percent" DECIMAL(5,2),
    "rate_type" "RateType",
    "tenure_months" INTEGER,
    "moratorium_months" INTEGER,
    "purpose" VARCHAR(250),
    "is_term_loan" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "epf_establishment_code" VARCHAR(32),
    "esic_code" VARCHAR(32),
    "total_employees" INTEGER,
    "epf_registered_employees" INTEGER,
    "local_employees" INTEGER,
    "skilled_count" INTEGER,
    "semi_skilled_count" INTEGER,
    "unskilled_count" INTEGER,
    "male_count" INTEGER,
    "female_count" INTEGER,
    "differently_abled_count" INTEGER,
    "contract_employees" INTEGER,
    "employment_generated_new" INTEGER,
    "as_on_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "land_cost" DECIMAL(16,2),
    "land_development_cost" DECIMAL(16,2),
    "building_cost" DECIMAL(16,2),
    "plant_machinery_cost" DECIMAL(16,2),
    "electrical_installation_cost" DECIMAL(16,2),
    "equipment_cost" DECIMAL(16,2),
    "furniture_fixture_cost" DECIMAL(16,2),
    "other_eligible_cost" DECIMAL(16,2),
    "pre_operative_expenses" DECIMAL(16,2),
    "total_project_cost" DECIMAL(16,2),
    "eligible_investment_total" DECIMAL(16,2),
    "promoter_contribution" DECIMAL(16,2),
    "term_loan_component" DECIMAL(16,2),
    "working_capital_component" DECIMAL(16,2),
    "other_source_amount" DECIMAL(16,2),
    "subsidy_claimed_amount" DECIMAL(16,2),
    "is_second_hand_machinery" BOOLEAN NOT NULL DEFAULT false,
    "machinery_invoice_count" INTEGER,
    "valuation_basis" VARCHAR(160),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "first_sale" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "first_sale_date" DATE,
    "invoice_number" VARCHAR(64),
    "invoice_date" DATE,
    "invoice_amount" DECIMAL(16,2),
    "buyer_name" VARCHAR(250),
    "buyer_gstin_enc" BYTEA,
    "buyer_gstin_last4" VARCHAR(4),
    "product_description" VARCHAR(250),
    "quantity" DECIMAL(14,3),
    "uom" VARCHAR(16),
    "e_way_bill_no" VARCHAR(32),
    "commercial_production_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "first_sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_document" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "document_type_id" UUID NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "status" "DocumentSlotStatus" NOT NULL DEFAULT 'REQUIRED',
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_by_user_id" UUID,
    "verified_at" TIMESTAMP(3),
    "notes" VARCHAR(1000),
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_rule" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" "RuleCategory" NOT NULL,
    "applies_to" "RuleAppliesTo" NOT NULL DEFAULT 'CASE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "validation_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_rule_version" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "scheme_version_id" UUID,
    "version_label" VARCHAR(32) NOT NULL,
    "severity" "RuleSeverity" NOT NULL DEFAULT 'WARNING',
    "expression" JSONB NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "message_template" VARCHAR(500) NOT NULL,
    "remediation_hint" VARCHAR(500),
    "source_reference" VARCHAR(250),
    "field_code" VARCHAR(80),
    "section" VARCHAR(32),
    "effective_from" DATE,
    "effective_to" DATE,
    "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "validation_rule_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_validation_run" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "trigger" "ValidationTrigger" NOT NULL DEFAULT 'MANUAL',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "blocking_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "info_count" INTEGER NOT NULL DEFAULT 0,
    "readiness_score" INTEGER NOT NULL DEFAULT 0,
    "ruleset_hash" VARCHAR(64) NOT NULL,
    "triggered_by_user_id" UUID,

    CONSTRAINT "case_validation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_validation_finding" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "severity" "RuleSeverity" NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "field_code" VARCHAR(80),
    "section" VARCHAR(32),
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "waived_by_user_id" UUID,
    "waived_at" TIMESTAMP(3),
    "waiver_reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_validation_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_template" (
    "id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "version_label" VARCHAR(32) NOT NULL,
    "language" VARCHAR(8) NOT NULL DEFAULT 'en',
    "body_text" TEXT NOT NULL,
    "body_sha256" BYTEA NOT NULL,
    "purpose_codes" TEXT[],
    "effective_from" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "is_draft_text" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consent_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_record" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "case_id" UUID,
    "template_id" UUID NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'RECORDED',
    "method" "ConsentMethod" NOT NULL DEFAULT 'CA_ATTESTATION',
    "attestation_text" TEXT NOT NULL,
    "template_sha256" BYTEA NOT NULL,
    "recorded_by_user_id" UUID,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "client_contact_name" VARCHAR(160),
    "ip_address" INET,
    "user_agent" VARCHAR(500),
    "valid_until" DATE,
    "withdrawn_at" TIMESTAMP(3),
    "withdrawn_reason" VARCHAR(500),
    "notes" VARCHAR(1000),

    CONSTRAINT "consent_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "firm_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_email_snapshot" VARCHAR(254),
    "actor_role_snapshot" VARCHAR(32),
    "action" "AuditAction" NOT NULL,
    "entity_type" VARCHAR(48) NOT NULL,
    "entity_id" UUID,
    "client_type" "ClientAppType" NOT NULL DEFAULT 'WEB',
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "failure_reason" VARCHAR(250),
    "ip_address" INET,
    "user_agent" VARCHAR(500),
    "request_id" VARCHAR(36) NOT NULL,
    "changed_fields" TEXT[],
    "metadata" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "firm_slug_key" ON "firm"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "firm_frn_key" ON "firm"("frn");

-- CreateIndex
CREATE UNIQUE INDEX "firm_gstin_key" ON "firm"("gstin");

-- CreateIndex
CREATE INDEX "firm_status_idx" ON "firm"("status");

-- CreateIndex
CREATE INDEX "firm_created_at_idx" ON "firm"("created_at");

-- CreateIndex
CREATE INDEX "role_firm_id_idx" ON "role"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_firm_id_key_key" ON "role"("firm_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_normalized_key" ON "app_user"("email_normalized");

-- CreateIndex
CREATE INDEX "app_user_firm_id_status_idx" ON "app_user"("firm_id", "status");

-- CreateIndex
CREATE INDEX "app_user_firm_id_role_id_idx" ON "app_user"("firm_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_firm_id_email_key" ON "app_user"("firm_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_firm_id_email_idx" ON "invitation"("firm_id", "email");

-- CreateIndex
CREATE INDEX "invitation_expires_at_idx" ON "invitation"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_client_type_idx" ON "refresh_token"("user_id", "client_type");

-- CreateIndex
CREATE INDEX "refresh_token_family_id_idx" ON "refresh_token"("family_id");

-- CreateIndex
CREATE INDEX "refresh_token_expires_at_idx" ON "refresh_token"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_token_hash_key" ON "password_reset_token"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_token_user_id_idx" ON "password_reset_token"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_token_expires_at_idx" ON "password_reset_token"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "district_code_key" ON "district"("code");

-- CreateIndex
CREATE INDEX "district_state_code_is_active_idx" ON "district"("state_code", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "taluka_code_key" ON "taluka"("code");

-- CreateIndex
CREATE INDEX "taluka_district_id_is_active_idx" ON "taluka"("district_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "bank_ifsc_key" ON "bank"("ifsc");

-- CreateIndex
CREATE INDEX "bank_firm_id_idx" ON "bank"("firm_id");

-- CreateIndex
CREATE INDEX "bank_name_idx" ON "bank"("name");

-- CreateIndex
CREATE INDEX "document_type_category_is_active_idx" ON "document_type"("category", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "document_type_firm_id_code_key" ON "document_type"("firm_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "scheme_code_key" ON "scheme"("code");

-- CreateIndex
CREATE INDEX "scheme_version_scheme_id_effective_from_idx" ON "scheme_version"("scheme_id", "effective_from");

-- CreateIndex
CREATE INDEX "scheme_version_status_idx" ON "scheme_version"("status");

-- CreateIndex
CREATE UNIQUE INDEX "scheme_version_scheme_id_version_label_key" ON "scheme_version"("scheme_id", "version_label");

-- CreateIndex
CREATE UNIQUE INDEX "scheme_document_requirement_scheme_version_id_document_type_key" ON "scheme_document_requirement"("scheme_version_id", "document_type_id");

-- CreateIndex
CREATE INDEX "client_firm_id_deleted_at_idx" ON "client"("firm_id", "deleted_at");

-- CreateIndex
CREATE INDEX "client_firm_id_legal_name_idx" ON "client"("firm_id", "legal_name");

-- CreateIndex
CREATE INDEX "client_firm_id_created_at_idx" ON "client"("firm_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_firm_id_pan_blind_index_key" ON "client"("firm_id", "pan_blind_index");

-- CreateIndex
CREATE UNIQUE INDEX "client_firm_id_gstin_blind_index_key" ON "client"("firm_id", "gstin_blind_index");

-- CreateIndex
CREATE INDEX "client_promoter_firm_id_client_id_idx" ON "client_promoter"("firm_id", "client_id");

-- CreateIndex
CREATE INDEX "client_promoter_client_id_is_primary_idx" ON "client_promoter"("client_id", "is_primary");

-- CreateIndex
CREATE UNIQUE INDEX "client_promoter_client_id_pan_blind_index_key" ON "client_promoter"("client_id", "pan_blind_index");

-- CreateIndex
CREATE INDEX "case_firm_id_status_idx" ON "case"("firm_id", "status");

-- CreateIndex
CREATE INDEX "case_firm_id_client_id_idx" ON "case"("firm_id", "client_id");

-- CreateIndex
CREATE INDEX "case_firm_id_assigned_to_user_id_status_idx" ON "case"("firm_id", "assigned_to_user_id", "status");

-- CreateIndex
CREATE INDEX "case_firm_id_updated_at_idx" ON "case"("firm_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "case_firm_id_case_number_key" ON "case"("firm_id", "case_number");

-- CreateIndex
CREATE UNIQUE INDEX "project_case_id_key" ON "project"("case_id");

-- CreateIndex
CREATE INDEX "project_firm_id_district_code_idx" ON "project"("firm_id", "district_code");

-- CreateIndex
CREATE UNIQUE INDEX "loan_case_id_key" ON "loan"("case_id");

-- CreateIndex
CREATE INDEX "loan_firm_id_bank_id_idx" ON "loan"("firm_id", "bank_id");

-- CreateIndex
CREATE INDEX "loan_firm_id_sanction_date_idx" ON "loan"("firm_id", "sanction_date");

-- CreateIndex
CREATE UNIQUE INDEX "employment_case_id_key" ON "employment"("case_id");

-- CreateIndex
CREATE INDEX "employment_firm_id_idx" ON "employment"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "investment_case_id_key" ON "investment"("case_id");

-- CreateIndex
CREATE INDEX "investment_firm_id_idx" ON "investment"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "first_sale_case_id_key" ON "first_sale"("case_id");

-- CreateIndex
CREATE INDEX "first_sale_firm_id_first_sale_date_idx" ON "first_sale"("firm_id", "first_sale_date");

-- CreateIndex
CREATE INDEX "case_document_firm_id_status_idx" ON "case_document"("firm_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "case_document_case_id_document_type_id_key" ON "case_document"("case_id", "document_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "validation_rule_code_key" ON "validation_rule"("code");

-- CreateIndex
CREATE INDEX "validation_rule_category_is_active_idx" ON "validation_rule"("category", "is_active");

-- CreateIndex
CREATE INDEX "validation_rule_version_scheme_version_id_status_idx" ON "validation_rule_version"("scheme_version_id", "status");

-- CreateIndex
CREATE INDEX "validation_rule_version_status_severity_idx" ON "validation_rule_version"("status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "validation_rule_version_rule_id_version_label_key" ON "validation_rule_version"("rule_id", "version_label");

-- CreateIndex
CREATE INDEX "case_validation_run_case_id_started_at_idx" ON "case_validation_run"("case_id", "started_at");

-- CreateIndex
CREATE INDEX "case_validation_run_firm_id_started_at_idx" ON "case_validation_run"("firm_id", "started_at");

-- CreateIndex
CREATE INDEX "case_validation_finding_run_id_severity_idx" ON "case_validation_finding"("run_id", "severity");

-- CreateIndex
CREATE INDEX "case_validation_finding_firm_id_severity_status_idx" ON "case_validation_finding"("firm_id", "severity", "status");

-- CreateIndex
CREATE INDEX "consent_template_is_active_idx" ON "consent_template"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "consent_template_code_version_label_language_key" ON "consent_template"("code", "version_label", "language");

-- CreateIndex
CREATE INDEX "consent_record_firm_id_client_id_status_idx" ON "consent_record"("firm_id", "client_id", "status");

-- CreateIndex
CREATE INDEX "consent_record_case_id_status_idx" ON "consent_record"("case_id", "status");

-- CreateIndex
CREATE INDEX "consent_record_recorded_at_idx" ON "consent_record"("recorded_at");

-- CreateIndex
CREATE INDEX "audit_log_firm_id_occurred_at_idx" ON "audit_log"("firm_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_firm_id_action_occurred_at_idx" ON "audit_log"("firm_id", "action", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_firm_id_entity_type_entity_id_idx" ON "audit_log"("firm_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_occurred_at_idx" ON "audit_log"("actor_user_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taluka" ADD CONSTRAINT "taluka_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "district"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank" ADD CONSTRAINT "bank_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_type" ADD CONSTRAINT "document_type_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_version" ADD CONSTRAINT "scheme_version_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "scheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_document_requirement" ADD CONSTRAINT "scheme_document_requirement_scheme_version_id_fkey" FOREIGN KEY ("scheme_version_id") REFERENCES "scheme_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_document_requirement" ADD CONSTRAINT "scheme_document_requirement_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client" ADD CONSTRAINT "client_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client" ADD CONSTRAINT "client_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_promoter" ADD CONSTRAINT "client_promoter_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_promoter" ADD CONSTRAINT "client_promoter_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_scheme_version_id_fkey" FOREIGN KEY ("scheme_version_id") REFERENCES "scheme_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan" ADD CONSTRAINT "loan_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan" ADD CONSTRAINT "loan_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan" ADD CONSTRAINT "loan_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment" ADD CONSTRAINT "employment_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment" ADD CONSTRAINT "employment_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment" ADD CONSTRAINT "investment_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment" ADD CONSTRAINT "investment_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "first_sale" ADD CONSTRAINT "first_sale_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "first_sale" ADD CONSTRAINT "first_sale_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_document" ADD CONSTRAINT "case_document_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_document" ADD CONSTRAINT "case_document_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_document" ADD CONSTRAINT "case_document_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_document" ADD CONSTRAINT "case_document_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_rule_version" ADD CONSTRAINT "validation_rule_version_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "validation_rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_rule_version" ADD CONSTRAINT "validation_rule_version_scheme_version_id_fkey" FOREIGN KEY ("scheme_version_id") REFERENCES "scheme_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_validation_run" ADD CONSTRAINT "case_validation_run_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_validation_run" ADD CONSTRAINT "case_validation_run_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_validation_run" ADD CONSTRAINT "case_validation_run_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_validation_finding" ADD CONSTRAINT "case_validation_finding_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "case_validation_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_validation_finding" ADD CONSTRAINT "case_validation_finding_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "validation_rule_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_validation_finding" ADD CONSTRAINT "case_validation_finding_waived_by_user_id_fkey" FOREIGN KEY ("waived_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "consent_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

