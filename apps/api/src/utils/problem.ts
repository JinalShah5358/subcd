import type { ProblemDetails } from '@ifp/shared';
import { PROBLEM_TYPES } from '@ifp/shared';

/**
 * Every error the API returns is one of these. The message reaching the client
 * is deliberately chosen at the throw site — nothing is ever derived from an
 * exception message, so internals cannot leak.
 */
export class AppError extends Error {
  readonly status: number;
  readonly type: string;
  readonly detail?: string;
  readonly errors?: Array<{ path: string; message: string }>;
  readonly conflictId?: string;
  /** Set to false for expected conditions so they are not logged as errors. */
  readonly expected: boolean;

  constructor(opts: {
    status: number;
    type: string;
    title: string;
    detail?: string;
    errors?: Array<{ path: string; message: string }>;
    conflictId?: string;
    expected?: boolean;
  }) {
    super(opts.title);
    this.name = 'AppError';
    this.status = opts.status;
    this.type = opts.type;
    if (opts.detail !== undefined) this.detail = opts.detail;
    if (opts.errors !== undefined) this.errors = opts.errors;
    if (opts.conflictId !== undefined) this.conflictId = opts.conflictId;
    this.expected = opts.expected ?? true;
  }

  toProblem(requestId: string, instance?: string): ProblemDetails {
    const problem: ProblemDetails = {
      type: this.type,
      title: this.message,
      status: this.status,
      requestId,
    };
    if (this.detail) problem.detail = this.detail;
    if (instance) problem.instance = instance;
    if (this.errors) problem.errors = this.errors;
    if (this.conflictId) problem.conflictId = this.conflictId;
    return problem;
  }
}

export const badRequest = (title: string, detail?: string) =>
  new AppError({ status: 400, type: PROBLEM_TYPES.validation, title, ...(detail ? { detail } : {}) });

export const validationFailed = (errors: Array<{ path: string; message: string }>) =>
  new AppError({
    status: 422,
    type: PROBLEM_TYPES.validation,
    title: 'Some fields need attention',
    errors,
  });

export const unauthorized = (title = 'Sign in to continue') =>
  new AppError({ status: 401, type: PROBLEM_TYPES.unauthorized, title });

export const forbidden = (title = 'You do not have permission to do that') =>
  new AppError({ status: 403, type: PROBLEM_TYPES.forbidden, title });

/**
 * Used for BOTH "does not exist" and "belongs to another firm". Returning 404
 * rather than 403 for a cross-tenant id avoids confirming that the id exists.
 */
export const notFound = (what = 'That record') =>
  new AppError({ status: 404, type: PROBLEM_TYPES.notFound, title: `${what} was not found` });

export const conflict = (title: string, detail?: string, conflictId?: string) =>
  new AppError({
    status: 409,
    type: PROBLEM_TYPES.conflict,
    title,
    ...(detail ? { detail } : {}),
    ...(conflictId ? { conflictId } : {}),
  });

export const duplicateClient = (title: string, conflictId: string, detail?: string) =>
  new AppError({
    status: 409,
    type: PROBLEM_TYPES.duplicate,
    title,
    conflictId,
    ...(detail ? { detail } : {}),
  });

export const preconditionFailed = (title: string, detail?: string) =>
  new AppError({
    status: 422,
    type: PROBLEM_TYPES.precondition,
    title,
    ...(detail ? { detail } : {}),
  });

/**
 * The licence lapsed and its grace period is over.
 *
 * 403 and not 402: Payment Required is reserved and unimplemented in HTTP,
 * and this is not always about payment anyway — a licence can lapse because
 * nobody renewed a pilot. The distinct problem type is what the web app keys
 * on to show a renewal message rather than a generic permission error.
 *
 * Reads are untouched. A firm can still open, search and export every case it
 * has; it simply cannot create or change one until the licence is renewed.
 */
export const licenseExpired = (expiredOn: string | null) =>
  new AppError({
    status: 403,
    type: PROBLEM_TYPES.licenseExpired,
    title: `This firm's licence has expired`,
    detail:
      (expiredOn ? `The licence ended on ${expiredOn}. ` : '') +
      'You can still read and export everything on file. Creating or changing records needs a renewed licence.',
  });

/** A quota is full. The message names the limit rather than a code. */
export const licenseQuota = (title: string, detail: string) =>
  new AppError({ status: 403, type: PROBLEM_TYPES.licenseQuota, title, detail });

export const rateLimited = (title = 'Too many requests — please wait and try again') =>
  new AppError({ status: 429, type: PROBLEM_TYPES.rateLimited, title });

export const internal = (title = 'Something went wrong') =>
  new AppError({ status: 500, type: PROBLEM_TYPES.internal, title, expected: false });
