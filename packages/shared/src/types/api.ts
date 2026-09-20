/** RFC 7807 problem+json — the only error shape this API returns. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  /** Field-level issues. Paths only — never echoes a sensitive submitted value. */
  errors?: Array<{ path: string; message: string }>;
  /** Present on 409 duplicate responses. */
  conflictId?: string;
}

/** Keyset pagination. Retained for anything that only ever scrolls forward. */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * The envelope every list endpoint returns.
 *
 * `total` is the count of rows matching the filter, not the page — the UI needs
 * it to render "showing 26–50 of 213" and to know how many page buttons exist.
 */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export interface ApiOk<T> {
  data: T;
}

export const PROBLEM_TYPES = {
  validation: 'https://ifp.local/problems/validation-failed',
  unauthorized: 'https://ifp.local/problems/unauthorized',
  forbidden: 'https://ifp.local/problems/forbidden',
  notFound: 'https://ifp.local/problems/not-found',
  conflict: 'https://ifp.local/problems/conflict',
  duplicate: 'https://ifp.local/problems/duplicate-client',
  precondition: 'https://ifp.local/problems/precondition-failed',
  licenseExpired: 'https://ifp.local/problems/licence-expired',
  licenseQuota: 'https://ifp.local/problems/licence-quota-exceeded',
  rateLimited: 'https://ifp.local/problems/rate-limited',
  internal: 'https://ifp.local/problems/internal-error',
} as const;
