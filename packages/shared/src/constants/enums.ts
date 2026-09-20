/**
 * Domain enums. These MUST stay in lockstep with prisma/schema.prisma.
 * A test in apps/api asserts that every member here exists in the generated
 * Prisma client enums, so drift becomes a failing test rather than a runtime bug.
 */

export const FIRM_STATUS = ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export type FirmStatus = (typeof FIRM_STATUS)[number];

export const USER_STATUS = ['INVITED', 'ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const ENTITY_TYPE = [
  'PROPRIETORSHIP',
  'PARTNERSHIP',
  'LLP',
  'PVT_LTD',
  'PUBLIC_LTD',
  'HUF',
  'TRUST',
  'SOCIETY',
  'COOP',
  'OTHER',
] as const;
export type EntityType = (typeof ENTITY_TYPE)[number];

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  PROPRIETORSHIP: 'Proprietorship',
  PARTNERSHIP: 'Partnership firm',
  LLP: 'Limited Liability Partnership',
  PVT_LTD: 'Private Limited Company',
  PUBLIC_LTD: 'Public Limited Company',
  HUF: 'Hindu Undivided Family',
  TRUST: 'Trust',
  SOCIETY: 'Society',
  COOP: 'Co-operative Society',
  OTHER: 'Other',
};

/**
 * 4th character of a PAN encodes the holder type. Used by a WARNING-level
 * rule, never as a hard block — the mapping is a convention, not a statute.
 */
export const PAN_FOURTH_CHAR_BY_ENTITY: Record<EntityType, string[]> = {
  PROPRIETORSHIP: ['P'],
  PARTNERSHIP: ['F'],
  LLP: ['F'],
  PVT_LTD: ['C'],
  PUBLIC_LTD: ['C'],
  HUF: ['H'],
  TRUST: ['T'],
  SOCIETY: ['A', 'S'],
  COOP: ['A', 'S'],
  OTHER: ['P', 'F', 'C', 'H', 'T', 'A', 'S', 'B', 'G', 'J', 'L'],
};

export const PROMOTER_ROLE = [
  'PROPRIETOR',
  'PARTNER',
  'DIRECTOR',
  'TRUSTEE',
  'MEMBER',
  'OTHER',
] as const;
export type PromoterRole = (typeof PROMOTER_ROLE)[number];

export const APPLICATION_TYPE = [
  'CAPITAL_SUBSIDY',
  'INTEREST_SUBSIDY',
  'PROVISIONAL_ELIGIBILITY',
  'FINAL_ELIGIBILITY',
] as const;
export type ApplicationType = (typeof APPLICATION_TYPE)[number];

export const APPLICATION_TYPE_LABEL: Record<ApplicationType, string> = {
  CAPITAL_SUBSIDY: 'Capital subsidy',
  INTEREST_SUBSIDY: 'Interest subsidy',
  PROVISIONAL_ELIGIBILITY: 'Provisional eligibility',
  FINAL_ELIGIBILITY: 'Final eligibility',
};

export const CASE_STATUS = [
  'DRAFT',
  'IN_REVIEW',
  'READY_TO_FILE',
  'FILED',
  'ACKNOWLEDGED',
  'QUERY_RAISED',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'ARCHIVED',
] as const;
export type CaseStatus = (typeof CASE_STATUS)[number];

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  READY_TO_FILE: 'Ready to file',
  FILED: 'Filed',
  ACKNOWLEDGED: 'Acknowledged',
  QUERY_RAISED: 'Query raised',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  ARCHIVED: 'Archived',
};

export const AREA_TYPE = ['URBAN', 'RURAL', 'MUNICIPAL', 'GIDC', 'OTHER'] as const;
export type AreaType = (typeof AREA_TYPE)[number];

export const RATE_TYPE = ['FIXED', 'FLOATING'] as const;
export type RateType = (typeof RATE_TYPE)[number];

export const BANK_TYPE = ['PSU', 'PRIVATE', 'COOP', 'RRB', 'NBFC', 'SFB', 'OTHER'] as const;
export type BankType = (typeof BANK_TYPE)[number];

export const DOCUMENT_SLOT_STATUS = [
  'REQUIRED',
  'PRESENT',
  'NOT_AVAILABLE',
  'NOT_APPLICABLE',
  'REJECTED',
] as const;
export type DocumentSlotStatus = (typeof DOCUMENT_SLOT_STATUS)[number];

export const VERIFICATION_STATUS = ['UNVERIFIED', 'VERIFIED', 'QUERY'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUS)[number];

export const DOCUMENT_CATEGORY = [
  'ENTITY',
  'PROMOTER',
  'PROJECT',
  'FINANCE',
  'EMPLOYMENT',
  'SALES',
  'OTHER',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORY)[number];

export const RULE_SEVERITY = ['BLOCKING', 'WARNING', 'INFO'] as const;
export type RuleSeverity = (typeof RULE_SEVERITY)[number];

export const RULE_CATEGORY = [
  'FORMAT',
  'REQUIRED',
  'DATE_WINDOW',
  'CONSISTENCY',
  'RATIO',
  'DUPLICATE',
  'DOCUMENT',
  'CROSS_FIELD',
] as const;
export type RuleCategory = (typeof RULE_CATEGORY)[number];

export const RULE_STATUS = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type RuleStatus = (typeof RULE_STATUS)[number];

export const FINDING_STATUS = ['OPEN', 'ACKNOWLEDGED', 'WAIVED', 'RESOLVED'] as const;
export type FindingStatus = (typeof FINDING_STATUS)[number];

export const VALIDATION_TRIGGER = ['MANUAL', 'ON_SAVE', 'PRE_AUTOFILL', 'SCHEDULED'] as const;
export type ValidationTrigger = (typeof VALIDATION_TRIGGER)[number];

export const CONSENT_STATUS = ['RECORDED', 'WITHDRAWN', 'EXPIRED'] as const;
export type ConsentStatus = (typeof CONSENT_STATUS)[number];

export const CONSENT_METHOD = [
  'CA_ATTESTATION',
  'SIGNED_DOCUMENT',
  'EMAIL_CONFIRMATION',
] as const;
export type ConsentMethod = (typeof CONSENT_METHOD)[number];

export const CLIENT_APP_TYPE = ['WEB', 'EXTENSION', 'SYSTEM', 'CLI'] as const;
export type ClientAppType = (typeof CLIENT_APP_TYPE)[number];

export const AUDIT_OUTCOME = ['SUCCESS', 'FAILURE', 'DENIED'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOME)[number];

export const SCHEME_VERSION_STATUS = ['DRAFT', 'ACTIVE', 'SUPERSEDED'] as const;
export type SchemeVersionStatus = (typeof SCHEME_VERSION_STATUS)[number];

export const AUDIT_ACTION = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'LOGOUT',
  'TOKEN_REFRESHED',
  'TOKEN_REUSE_DETECTED',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'USER_INVITED',
  'USER_ACTIVATED',
  'USER_UPDATED',
  'USER_DISABLED',
  'ROLE_CHANGED',
  'EXTENSION_PAIRING_STARTED',
  'EXTENSION_DEVICE_PAIRED',
  'EXTENSION_DEVICE_REVOKED',
  'FORM_CAPTURED',
  'FORM_VERSION_STATUS_CHANGED',
  'FIELD_MAPPED',
  'AUTOFILL_COMPLETED',
  'FIRM_CREATED',
  'FIRM_UPDATED',
  'FIRM_STATUS_CHANGED',
  'FIRM_LICENSE_CHANGED',
  'CLIENT_CREATED',
  'CLIENT_UPDATED',
  'CLIENT_DELETED',
  'PROMOTER_CREATED',
  'PROMOTER_UPDATED',
  'PROMOTER_DELETED',
  'CASE_CREATED',
  'CASE_UPDATED',
  'CASE_STATUS_CHANGED',
  'CASE_DELETED',
  'CASE_SECTION_UPDATED',
  'SENSITIVE_DATA_VIEWED',
  'SENSITIVE_FIELD_REVEALED',
  'DOCUMENT_SLOT_UPDATED',
  'DATA_EXPORTED',
  'VALIDATION_RUN',
  'VALIDATION_WAIVED',
  'CONSENT_RECORDED',
  'CONSENT_WITHDRAWN',
  'RULE_VERSION_PUBLISHED',
  'RETENTION_PURGE_EXECUTED',
  'ACCESS_DENIED',
] as const;
export type AuditAction = (typeof AUDIT_ACTION)[number];
