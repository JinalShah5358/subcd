import type { CaseStatus } from './enums';

/**
 * Case status state machine. Enforced in the API service layer — the UI only
 * mirrors it for affordances. Any transition not listed here is rejected.
 */
export const CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  DRAFT: ['IN_REVIEW', 'WITHDRAWN', 'ARCHIVED'],
  IN_REVIEW: ['DRAFT', 'READY_TO_FILE', 'WITHDRAWN'],
  READY_TO_FILE: ['IN_REVIEW', 'FILED', 'WITHDRAWN'],
  FILED: ['ACKNOWLEDGED', 'QUERY_RAISED', 'REJECTED', 'APPROVED'],
  ACKNOWLEDGED: ['QUERY_RAISED', 'APPROVED', 'REJECTED'],
  QUERY_RAISED: ['IN_REVIEW', 'ACKNOWLEDGED', 'APPROVED', 'REJECTED'],
  APPROVED: ['ARCHIVED'],
  REJECTED: ['IN_REVIEW', 'ARCHIVED'],
  WITHDRAWN: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return (CASE_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Preconditions that the SERVER checks before allowing a transition.
 * Listed here so the UI can explain them before the user tries.
 */
export const TRANSITION_PRECONDITIONS: Partial<Record<CaseStatus, string[]>> = {
  IN_REVIEW: ['No open BLOCKING validation findings'],
  READY_TO_FILE: [
    'No open BLOCKING validation findings',
    'All mandatory documents marked present or not applicable',
    'An active consent record exists for this case',
  ],
  FILED: [
    'The CA has submitted the application on the portal themselves',
    'Portal application number recorded',
  ],
};

/** Statuses after which the case is read-only for ordinary edits. */
export const LOCKED_STATUSES: CaseStatus[] = ['FILED', 'ACKNOWLEDGED', 'APPROVED', 'ARCHIVED'];

export function isLocked(status: CaseStatus): boolean {
  return LOCKED_STATUSES.includes(status);
}
