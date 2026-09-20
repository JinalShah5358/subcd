import { AsyncLocalStorage } from 'node:async_hooks';
import { forTenant, type TenantPrisma } from '../db/tenant';
import { internal } from '../utils/problem';

export interface RequestContext {
  requestId: string;
  ip: string | undefined;
  userAgent: string | undefined;
  clientType: 'WEB' | 'EXTENSION' | 'SYSTEM' | 'CLI';
  /** Present only once authenticate() has run. */
  auth?: {
    userId: string;
    firmId: string;
    email: string;
    roleKey: string;
    permissions: string[];
  };
  /** Tenant-scoped Prisma client. The only client a module may touch. */
  db?: TenantPrisma;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext {
  const ctx = storage.getStore();
  if (!ctx) throw internal('Request context is not available');
  return ctx;
}

export function tryGetContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getAuth(): NonNullable<RequestContext['auth']> {
  const { auth } = getContext();
  if (!auth) throw internal('Authenticated context expected but missing');
  return auth;
}

export function getFirmId(): string {
  return getAuth().firmId;
}

/** Tenant-scoped client for the current request. Never cache this across requests. */
export function db(): TenantPrisma {
  const ctx = getContext();
  if (!ctx.db) {
    const auth = ctx.auth;
    if (!auth) throw internal('Tenant client requested before authentication');
    ctx.db = forTenant(auth.firmId);
  }
  return ctx.db;
}
