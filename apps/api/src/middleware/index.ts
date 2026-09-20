import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError, type ZodTypeAny } from 'zod';
import { hasPermission, uuidv7, type Permission } from '@ifp/shared';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { AppError, forbidden, internal, rateLimited, unauthorized, validationFailed } from '../utils/problem';
import { getContext, runWithContext, type RequestContext } from '../auth/context';
import { verifyAccessToken } from '../auth/tokens';
import { findUserById } from '../auth/lookups';
import { writeAudit } from '../services/audit/auditWriter';

/* --------------------------- request context ---------------------------- */

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.header('x-request-id') ?? uuidv7()).slice(0, 36);
  const ctx: RequestContext = {
    requestId,
    ip: req.ip,
    userAgent: req.header('user-agent'),
    clientType: 'WEB',
  };
  res.setHeader('x-request-id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](
      {
        requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs,
        userId: ctx.auth?.userId,
      },
      'request',
    );
  });

  runWithContext(ctx, () => next());
}

/* ------------------------------ auth ------------------------------------ */

/**
 * Verifies the bearer token, then re-reads the user from the database.
 *
 * Re-reading on every request costs one indexed lookup and buys immediate
 * revocation: disabling a user or changing their role takes effect on their
 * very next request rather than when their 15-minute access token expires.
 */
export function authenticate(options: { optional?: boolean } = {}) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.header('authorization');
      if (!header?.startsWith('Bearer ')) {
        if (options.optional) return next();
        throw unauthorized();
      }

      const claims = verifyAccessToken(header.slice(7));

      const user = await findUserById(claims.sub);

      if (!user || user.deleted_at || user.status !== 'ACTIVE') {
        throw unauthorized('This account is no longer active');
      }
      if (user.firm_status !== 'ACTIVE') {
        throw forbidden('This firm account is suspended');
      }
      if (user.firm_id !== claims.firmId) {
        // Token firm does not match the stored firm — refuse outright.
        throw unauthorized('Please sign in again');
      }

      const store = getContext();
      store.clientType = claims.clientType === 'EXTENSION' ? 'EXTENSION' : 'WEB';
      store.auth = {
        userId: user.id,
        firmId: user.firm_id,
        email: user.email,
        roleKey: user.role_key,
        // Permissions come from the DATABASE, not the token, so a role change
        // cannot be outrun by a token issued a moment earlier.
        permissions: user.role_permissions,
      };
      store.db = undefined;

      next();
    } catch (err) {
      next(err);
    }
  };
}

/* --------------------------- authorization ------------------------------ */

export function authorize(...required: Permission[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = getContext();
      if (!ctx.auth) throw unauthorized();

      const ok = required.every((p) => hasPermission(ctx.auth!.permissions, p));
      if (!ok) {
        await writeAudit({
          action: 'ACCESS_DENIED',
          entityType: 'route',
          outcome: 'DENIED',
          failureReason: `missing permission: ${required.join(', ')}`,
          metadata: { source: req.originalUrl.split('?')[0] ?? 'unknown' },
        });
        throw forbidden();
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/* ------------------------------ validation ------------------------------ */

type Source = 'body' | 'query' | 'params';

export function validate<T extends ZodTypeAny>(schema: T, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(toValidationError(result.error));
    }
    // Store the parsed value; do not mutate req.query (getter-only in Express 5).
    (req as unknown as Record<string, unknown>)[`valid_${source}`] = result.data;
    next();
  };
}

export function toValidationError(error: ZodError): AppError {
  return validationFailed(
    error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  );
}

/** Typed accessor for a validated payload. */
export function valid<T>(req: Request, source: Source = 'body'): T {
  return (req as unknown as Record<string, unknown>)[`valid_${source}`] as T;
}

/* ------------------------------ rate limits ----------------------------- */

const limiter = (windowMs: number, max: number, name: string) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => !env.RATE_LIMIT_ENABLED,
    keyGenerator: (req) => {
      const ctx = (() => {
        try {
          return getContext();
        } catch {
          return undefined;
        }
      })();
      return `${name}:${ctx?.auth?.userId ?? req.ip}`;
    },
    handler: (_req, _res, next) => next(rateLimited()),
  });

export const rateLimits = {
  login: limiter(60_000, 5, 'login'),
  refresh: limiter(60_000, 30, 'refresh'),
  passwordReset: limiter(15 * 60_000, 5, 'reset'),
  reveal: limiter(60_000, 20, 'reveal'),
  read: limiter(60_000, 300, 'read'),
  write: limiter(60_000, 120, 'write'),
};

/* ------------------------------ error handler --------------------------- */

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(
    new AppError({
      status: 404,
      type: 'https://ifp.local/problems/not-found',
      title: `No route matches ${req.method} ${req.originalUrl.split('?')[0]}`,
    }),
  );
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = res.getHeader('x-request-id')?.toString() ?? 'unknown';
  const instance = req.originalUrl.split('?')[0];

  if (err instanceof ZodError) {
    const appErr = toValidationError(err);
    res.status(appErr.status).type('application/problem+json').json(appErr.toProblem(requestId, instance));
    return;
  }

  if (err instanceof AppError) {
    if (!err.expected) {
      logger.error({ err, requestId }, 'unexpected application error');
    }
    res.status(err.status).type('application/problem+json').json(err.toProblem(requestId, instance));
    return;
  }

  // Prisma and everything else: log the detail, return nothing revealing.
  logger.error({ err, requestId, path: instance }, 'unhandled error');
  const fallback = internal();
  res
    .status(fallback.status)
    .type('application/problem+json')
    .json(fallback.toProblem(requestId, instance));
}

/** Wraps an async handler so rejections reach the error middleware. */
export function handler<T>(
  fn: (req: Request, res: Response) => Promise<T>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
