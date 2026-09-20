import type { LicensePlan, LicenseState, Page, SessionUser } from '@ifp/shared';
import { del, get, patch, post, put } from './client';

/* ------------------------------- types -------------------------------- */

/** Re-exported so a page imports its list envelope from one place. */
export type { Page } from '@ifp/shared';

export type ListQuery = Record<string, string | number | undefined>;

export interface ClientSummary {
  id: string;
  legalName: string;
  tradeName: string | null;
  entityType: string;
  panMasked: string | null;
  gstinMasked: string | null;
  udyamMasked: string | null;
  contactPersonName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  caseCount?: number;
  createdAt: string;
  deletedAt: string | null;
}

export interface Promoter {
  id: string;
  fullName: string;
  designation: string;
  ownershipPercent: string | null;
  panMasked: string | null;
  aadhaarMasked: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  addressLine1: string | null;
  city: string | null;
  pincode: string | null;
  isPrimary: boolean;
}

export interface ClientDetail extends ClientSummary {
  constitutionNote: string | null;
  businessActivity: string | null;
  nicCode: string | null;
  incorporationDate: string | null;
  regdAddressLine1: string | null;
  regdAddressLine2: string | null;
  regdCity: string | null;
  regdDistrictCode: string | null;
  regdPincode: string | null;
  notes: string | null;
  updatedAt: string;
  promoters: Promoter[];
  cases: Array<{
    id: string;
    caseNumber: string;
    status: string;
    applicationType: string;
    readinessScore: number;
    updatedAt: string;
  }>;
}

export interface CaseSummary {
  id: string;
  caseNumber: string;
  title: string | null;
  applicationType: string;
  status: string;
  statusLabel: string;
  readinessScore: number;
  applicationDate: string | null;
  updatedAt: string;
  client: { id: string; legalName: string };
  assignedTo: { id: string; fullName: string } | null;
}

export interface CaseDocumentSlot {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  category: string;
  isRequired: boolean;
  status: string;
  verificationStatus: string;
  notes: string | null;
}

export interface CaseDetail {
  id: string;
  caseNumber: string;
  title: string | null;
  applicationType: string;
  status: string;
  statusLabel: string;
  statusReason: string | null;
  applicationDate: string | null;
  portalApplicationNo: string | null;
  filedAt: string | null;
  readinessScore: number;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  client: { id: string; legalName: string; entityType: string; panMasked: string | null; gstinMasked: string | null };
  schemeVersion: {
    id: string;
    versionLabel: string;
    status: string;
    scheme: { code: string; name: string };
  };
  assignedTo: { id: string; fullName: string } | null;
  project: Record<string, unknown> | null;
  loan: Record<string, unknown> | null;
  employment: Record<string, unknown> | null;
  investment: Record<string, unknown> | null;
  firstSale: Record<string, unknown> | null;
  documents: CaseDocumentSlot[];
  consent: { id: string; recordedAt: string; method: string; validUntil: string | null } | null;
}

export interface Finding {
  id: string;
  ruleCode: string;
  ruleName: string;
  category: string;
  severity: 'BLOCKING' | 'WARNING' | 'INFO';
  message: string;
  remediationHint: string | null;
  sourceReference: string | null;
  fieldCode: string | null;
  section: string | null;
  status: string;
  waiverReason: string | null;
}

export interface ValidationRun {
  id: string;
  caseId: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  readinessScore: number;
  rulesetHash: string;
  triggeredBy: { id: string; fullName: string } | null;
  findings: Finding[];
}

export interface FirmProfile {
  id: string;
  name: string;
  slug: string;
  frn: string | null;
  gstin: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  status: string;
  dataRegion: string;
  retentionMonths: number;
  createdAt: string;
  _count: { users: number; clients: number; cases: number };
  /** Read-only here. Only a platform administrator can change it. */
  license: LicenseView;
}

export interface FirmUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  role: { id: string; key: string; name: string };
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  clientType: string;
  outcome: string;
  failureReason: string | null;
  ipAddress: string | null;
  requestId: string;
  changedFields: string[];
  metadata: Record<string, unknown> | null;
  occurredAt: string;
}

export interface District {
  id: string;
  code: string;
  name: string;
  dicCode: string | null;
  dicName: string | null;
}

export interface SchemeWithVersions {
  id: string;
  code: string;
  name: string;
  authority: string | null;
  versions: Array<{
    id: string;
    versionLabel: string;
    status: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    sourceReference: string | null;
    unverified: boolean;
  }>;
}

/* ------------------------------- calls -------------------------------- */

export const authApi = {
  login: (email: string, password: string) =>
    post<{ accessToken: string; expiresInSeconds: number; user: SessionUser }>('/auth/login', {
      email,
      password,
    }),
  refresh: () =>
    post<{ accessToken: string; expiresInSeconds: number; user: SessionUser }>('/auth/refresh'),
  logout: () => post<void>('/auth/logout'),
  me: () => get<{ user: SessionUser }>('/auth/me'),
  forgot: (email: string) => post<{ message: string }>('/auth/password/forgot', { email }),
  reset: (token: string, password: string) => post<void>('/auth/password/reset', { token, password }),
  change: (currentPassword: string, newPassword: string) =>
    post<void>('/auth/password/change', { currentPassword, newPassword }),
  acceptInvite: (token: string, fullName: string, password: string) =>
    post<void>('/auth/invitations/accept', { token, fullName, password }),
};

export const clientsApi = {
  list: (query: ListQuery) => get<Page<ClientSummary>>('/clients', query),
  get: (id: string) => get<ClientDetail>(`/clients/${id}`),
  create: (body: unknown) => post<ClientSummary>('/clients', body),
  update: (id: string, body: unknown) => patch<ClientSummary>(`/clients/${id}`, body),
  remove: (id: string) => del<void>(`/clients/${id}`),
  checkDuplicate: (body: { pan?: string | null; gstin?: string | null; excludeClientId?: string }) =>
    post<{ duplicate: boolean; clientId: string | null; legalName: string | null; matchedOn: string | null }>(
      '/clients/check-duplicate',
      body,
    ),
  reveal: (id: string, field: 'pan' | 'gstin' | 'udyam') =>
    post<{ field: string; value: string | null }>(`/clients/${id}/reveal`, { field }),
  addPromoter: (id: string, body: unknown) => post<Promoter>(`/clients/${id}/promoters`, body),
  updatePromoter: (id: string, promoterId: string, body: unknown) =>
    patch<Promoter>(`/clients/${id}/promoters/${promoterId}`, body),
  removePromoter: (id: string, promoterId: string) =>
    del<void>(`/clients/${id}/promoters/${promoterId}`),
  revealPromoterPan: (id: string, promoterId: string) =>
    post<{ field: string; value: string | null }>(`/clients/${id}/promoters/${promoterId}/reveal`),
};

export const casesApi = {
  list: (query: ListQuery) => get<Page<CaseSummary>>('/cases', query),
  get: (id: string) => get<CaseDetail>(`/cases/${id}`),
  create: (body: unknown) => post<{ id: string; caseNumber: string }>('/cases', body),
  update: (id: string, body: unknown) => patch<unknown>(`/cases/${id}`, body),
  remove: (id: string) => del<void>(`/cases/${id}`),
  setStatus: (id: string, body: unknown) =>
    post<{ id: string; status: string; statusLabel: string }>(`/cases/${id}/status`, body),
  saveSection: (id: string, section: string, body: unknown) =>
    put<{ id: string; section: string }>(`/cases/${id}/${section}`, body),
  documents: (id: string) => get<CaseDocumentSlot[]>(`/cases/${id}/documents`),
  updateDocument: (id: string, slotId: string, body: unknown) =>
    patch<CaseDocumentSlot>(`/cases/${id}/documents/${slotId}`, body),
  validate: (id: string) => post<ValidationRun>(`/cases/${id}/validate`),
};

export const validationApi = {
  latest: (caseId: string) => get<ValidationRun | null>(`/validation/cases/${caseId}/latest`),
  waive: (findingId: string, reason: string) =>
    post<{ id: string; status: string }>(`/validation/findings/${findingId}/waive`, { reason }),
  rules: () => get<unknown[]>('/validation/rules'),
  inactiveRules: () =>
    get<Array<{ code: string; name: string; category: string; severity: string; reason: string }>>(
      '/validation/rules/inactive',
    ),
};

export const consentApi = {
  activeTemplate: () =>
    get<{
      id: string;
      code: string;
      versionLabel: string;
      bodyText: string;
      purposeCodes: string[];
      isDraftText: boolean;
      warning: string | null;
    }>('/consent/templates/active'),
  records: (query: { clientId?: string; caseId?: string }) =>
    get<
      Array<{
        id: string;
        clientId: string;
        clientName: string;
        caseId: string | null;
        status: string;
        method: string;
        recordedAt: string;
        recordedBy: { id: string; fullName: string } | null;
        template: { code: string; versionLabel: string; language: string };
        attestationText: string;
        validUntil: string | null;
        withdrawnAt: string | null;
        withdrawnReason: string | null;
      }>
    >('/consent/records', query),
  record: (body: unknown) => post<{ id: string; status: string }>('/consent/records', body),
  withdraw: (id: string, reason: string) =>
    post<{ id: string; status: string; notice: string }>(`/consent/records/${id}/withdraw`, { reason }),
};

export const referenceApi = {
  districts: () => get<District[]>('/reference/districts'),
  talukas: (districtCode: string) =>
    get<Array<{ id: string; code: string; name: string }>>(`/reference/districts/${districtCode}/talukas`),
  documentTypes: () =>
    get<Array<{ id: string; code: string; name: string; category: string }>>('/reference/document-types'),
  schemes: () => get<SchemeWithVersions[]>('/reference/schemes'),
  banks: (q?: string) =>
    get<Array<{ id: string; name: string; branchName: string; ifsc: string | null; city: string | null }>>(
      '/reference/banks',
      q ? { q } : undefined,
    ),
  bankNames: () => get<string[]>('/reference/bank-names'),
};

export const adminApi = {
  firm: () => get<FirmProfile>('/firms/current'),
  updateFirm: (body: unknown) => patch<unknown>('/firms/current', body),
  users: (query?: ListQuery) => get<Page<FirmUser>>('/users', query ?? {}),
  invitations: () =>
    get<
      Array<{
        id: string;
        email: string;
        fullName: string;
        expiresAt: string;
        createdAt: string;
        expired: boolean;
        role: { key: string; name: string };
        invitedBy: { id: string; fullName: string } | null;
      }>
    >('/users/invitations'),
  invite: (body: unknown) => post<{ id: string; email: string }>('/users/invitations', body),
  revokeInvite: (id: string) => del<void>(`/users/invitations/${id}`),
  updateUser: (id: string, body: unknown) => patch<FirmUser>(`/users/${id}`, body),
  disableUser: (id: string) => post<void>(`/users/${id}/disable`),
  enableUser: (id: string) => post<void>(`/users/${id}/enable`),
  audit: (query: ListQuery) => get<Page<AuditRow>>('/audit', query),
  auditForEntity: (type: string, id: string) => get<AuditRow[]>(`/audit/entities/${type}/${id}`),
};

/* ---------------------------- platform admin ---------------------------- */

/**
 * A firm's licence as the API reports it.
 *
 * `state` and `readOnly` are derived server-side rather than here, so the
 * banner this drives and the refusals the API issues cannot disagree about
 * which day a licence ended.
 */
export interface LicenseView {
  plan: LicensePlan;
  state: LicenseState;
  readOnly: boolean;
  expiresAt: string | null;
  daysRemaining: number | null;
  graceDays: number;
  graceDaysRemaining: number | null;
  limits: { users: number | null; clients: number | null; cases: number | null };
  used: { users: number; clients: number; cases: number };
}

export interface PlatformFirmSummary {
  id: string;
  name: string;
  slug: string;
  frn: string | null;
  status: string;
  dataRegion: string;
  contactEmail: string | null;
  createdAt: string;
  userCount: number;
  clientCount: number;
  caseCount: number;
  lastActiveAt: string | null;
  license: LicenseView;
}

export interface PlatformFirmDetail extends PlatformFirmSummary {
  gstin: string | null;
  retentionMonths: number;
  contactPhone: string | null;
  city: string | null;
  state: string | null;
  activeUserCount: number;
  license: LicenseView & { note: string | null; updatedAt: string | null };
}

/** One row of the renewals list. Carries no quota — this screen is about dates. */
export interface ExpiringLicense {
  id: string;
  name: string;
  slug: string;
  status: string;
  contactEmail: string | null;
  plan: LicensePlan;
  state: LicenseState;
  readOnly: boolean;
  expiresAt: string;
  daysRemaining: number;
  graceDaysRemaining: number | null;
}

export interface LicenseUpdateBody {
  plan: LicensePlan;
  expiresAt: string | null;
  graceDays: number;
  maxUsers: number | null;
  maxClients: number | null;
  maxCases: number | null;
  note: string | null;
  reason: string;
}

export interface PlatformTotals {
  firmCount: number;
  activeFirms: number;
  suspendedFirms: number;
  userCount: number;
  clientCount: number;
  caseCount: number;
}

export const platformApi = {
  totals: () => get<PlatformTotals>('/platform/totals'),
  firms: (query: ListQuery) => get<Page<PlatformFirmSummary>>('/platform/firms', query),
  firm: (id: string) => get<PlatformFirmDetail>(`/platform/firms/${id}`),
  createFirm: (body: unknown) =>
    post<{
      id: string;
      name: string;
      slug: string;
      status: string;
      invitation: { id: string; email: string; expiresAt: string };
    }>('/platform/firms', body),
  setFirmStatus: (id: string, body: { status: string; reason: string }) =>
    patch<{ id: string; name: string; status: string }>(`/platform/firms/${id}/status`, body),

  /** PUT, not PATCH: a licence is replaced whole. See the route's comment. */
  setLicense: (id: string, body: LicenseUpdateBody) =>
    put<{
      id: string;
      name: string;
      license: LicenseView & { note: string | null; updatedAt: string | null };
      alreadyOverLimit: string[];
    }>(`/platform/firms/${id}/license`, body),

  expiring: (query: ListQuery & { withinDays?: number }) =>
    get<Page<ExpiringLicense>>('/platform/licenses/expiring', query),
};

/* ------------------------------ extension ------------------------------- */

export interface ExtensionDevice {
  id: string;
  label: string;
  agentVersion: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  expiresAt: string;
  createdAt: string;
  expired: boolean;
}

export interface FormVersionSummary {
  id: string;
  label: string;
  status: 'CAPTURED' | 'ACTIVE' | 'RETIRED';
  fingerprint: string;
  capturedAt: string;
  note: string | null;
  isShared: boolean;
  form: { code: string; name: string; host: string };
  fieldCount: number;
  mappedCount: number;
}

export interface CapturedField {
  id: string;
  selector: string;
  controlType: string;
  inputType: string | null;
  labelText: string | null;
  nameAttr: string | null;
  idAttr: string | null;
  required: boolean;
  maxLength: number | null;
  options: Array<{ value: string; label: string }> | null;
  refusedReason: string | null;
  mapping: {
    id: string;
    sourcePath: string;
    transform: string | null;
    optionMap: Record<string, string> | null;
    confirmed: boolean;
    note: string | null;
  } | null;
}

export interface FormVersionDetail {
  id: string;
  label: string;
  status: 'CAPTURED' | 'ACTIVE' | 'RETIRED';
  note: string | null;
  capturedAt: string;
  isShared: boolean;
  form: { code: string; name: string; host: string };
  sourcePaths: Record<string, string>;
  transforms: string[];
  fields: CapturedField[];
}

export const extensionApi = {
  pairingCode: () =>
    post<{ code: string; expiresAt: string; ttlMinutes: number }>('/extension/pairing-codes'),
  devices: () => get<ExtensionDevice[]>('/extension/devices'),
  revokeDevice: (id: string, reason?: string) =>
    del<void>(`/extension/devices/${id}`, { reason }),
  formVersions: () => get<FormVersionSummary[]>('/extension/form-versions'),
  formVersion: (id: string) => get<FormVersionDetail>(`/extension/form-versions/${id}`),
  saveMapping: (versionId: string, body: unknown) =>
    put<unknown>(`/extension/form-versions/${versionId}/mappings`, body),
  deleteMapping: (versionId: string, fieldId: string) =>
    del<void>(`/extension/form-versions/${versionId}/mappings/${fieldId}`),
  setVersionStatus: (id: string, status: string) =>
    patch<{ id: string; status: string }>(`/extension/form-versions/${id}/status`, { status }),
};
