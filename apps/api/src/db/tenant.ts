import { Prisma } from '@prisma/client';
import { basePrisma } from './prisma';
import { forbidden, internal } from '../utils/problem';

/**
 * Tenant isolation, layer 1 of 2.
 *
 * Layer 1 (here): a Prisma client extension that injects `firmId` into every
 *   query against a tenant-owned model, and rejects any attempt to write a row
 *   for a different firm. This makes the correct thing the default.
 *
 * Layer 2 (the database): Row Level Security policies keyed on a
 *   transaction-local `app.firm_id`, set by withTenant(). This makes the wrong
 *   thing impossible even if layer 1 has a bug.
 *
 * Neither layer is sufficient alone. F-01 tests both.
 */

/** Models that carry firm_id and must never be queried without a tenant filter. */
export const TENANT_MODELS = new Set<string>([
  'User',
  'Invitation',
  'RefreshToken',
  'PasswordResetToken',
  'Client',
  'ClientPromoter',
  'Case',
  'Project',
  'Loan',
  'Employment',
  'Investment',
  'FirstSale',
  'CaseDocument',
  'CaseValidationRun',
  'CaseValidationFinding',
  'ConsentRecord',
  'AuditLog',
  // Extension: a firm's own devices and its own record of what they did.
  'ExtensionDevice',
  'AutofillSession',
  'AutofillFieldOutcome',
]);

/** Models with optional firm_id: global rows (null) are shared, firm rows are private. */
export const HYBRID_MODELS = new Set<string>([
  'Role',
  'Bank',
  'DocumentType',
  // A form capture starts private to the firm that made it and becomes a
  // shared catalog row (firmId null) once someone has checked it.
  'FormVersion',
  'FormField',
  'FieldMapping',
]);

/**
 * The tenant row itself. `firm` has no firm_id column — its tenant key IS its
 * primary key, and the RLS policy reads `id = app_current_firm_id()`.
 *
 * Leaving it out of every set was a real bug: the extension skipped the model,
 * so no transaction was opened, `app.firm_id` was never set, the policy failed
 * closed, and GET /firms/current returned 404 for a firm that plainly exists.
 * RLS was behaving correctly — the client simply never said who was asking.
 */
export const SELF_MODELS = new Set<string>(['Firm']);

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** Take a free-form where: the tenant predicate can be an AND clause. */
const BULK_WRITE_OPERATIONS = new Set(['updateMany', 'deleteMany']);

/** Require a UNIQUE where: the tenant predicate must be a sibling key. */
const SINGLE_ROW_WRITE_OPERATIONS = new Set(['update', 'delete', 'upsert']);

const CREATE_OPERATIONS = new Set(['create', 'createMany', 'upsert']);

function assertNoForeignFirmId(data: unknown, firmId: string): void {
  if (!data || typeof data !== 'object') return;
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const candidate = (row as Record<string, unknown>).firmId;
    if (candidate !== undefined && candidate !== null && candidate !== firmId) {
      // A request tried to write into another firm. This is either a bug or an attack.
      throw forbidden('That operation is not allowed');
    }
  }
}

function injectFirmId<T>(data: T, firmId: string): T {
  if (Array.isArray(data)) {
    return data.map((row) => ({ ...row, firmId })) as unknown as T;
  }
  if (data && typeof data === 'object') {
    return { ...(data as Record<string, unknown>), firmId } as unknown as T;
  }
  return data;
}

export type TenantPrisma = ReturnType<typeof forTenant>;

export interface ScopeInput {
  model: string;
  operation: string;
  args: Record<string, unknown>;
  firmId: string;
}

export interface ScopeResult {
  /** The operation to dispatch — findUnique may be rewritten to findFirst. */
  operation: string;
  args: Record<string, unknown>;
  /** False when the model carries no tenant column and needs no scoping. */
  scoped: boolean;
}

/**
 * Applies the tenant predicate to one operation's arguments.
 *
 * Pulled out of the client extension so it can be exercised directly, over
 * every model and every operation, without a database. The extension below is
 * then a thin wrapper: this function decides, it dispatches.
 */
export function applyTenantScope({ model, operation, args, firmId }: ScopeInput): ScopeResult {
  if (!firmId) throw internal('Tenant context missing');

  const isTenant = TENANT_MODELS.has(model);
  const isHybrid = HYBRID_MODELS.has(model);
  const isSelf = SELF_MODELS.has(model);
  if (!isTenant && !isHybrid && !isSelf) {
    return { operation, args, scoped: false };
  }

  // The tenant column: `id` on the firm row, `firm_id` everywhere else.
  const tenantKey = isSelf ? 'id' : 'firmId';

  const a = args;
  let effectiveOperation = operation;

  // Reads and bulk writes take a free-form where, so the tenant predicate
  // goes in as an AND clause.
  if (READ_OPERATIONS.has(operation) || BULK_WRITE_OPERATIONS.has(operation)) {
    const tenantPredicate = isHybrid ? { OR: [{ firmId }, { firmId: null }] } : { [tenantKey]: firmId };

    a.where = { AND: [a.where ?? {}, tenantPredicate] };

    // Prisma rejects a compound AND in findUnique's where, because it demands
    // a unique selector. Re-issue it as findFirst — same result, and the
    // tenant predicate survives.
    if (operation === 'findUnique') effectiveOperation = 'findFirst';
    if (operation === 'findUniqueOrThrow') effectiveOperation = 'findFirstOrThrow';
  }

  // Single-row writes need a UNIQUE selector, so the tenant goes in as a
  // sibling filter rather than an AND wrapper (Prisma's extended
  // where-unique). A row belonging to another firm then matches nothing — and
  // RLS refuses it a second time regardless.
  if (SINGLE_ROW_WRITE_OPERATIONS.has(operation)) {
    a.where = { ...((a.where as Record<string, unknown>) ?? {}), [tenantKey]: firmId };
  }

  // A firm-scoped client has no business minting firms. Provisioning a tenant
  // is a platform operation and runs through withoutTenant().
  if (isSelf && CREATE_OPERATIONS.has(operation)) {
    throw forbidden('That operation is not allowed');
  }

  // Creates: stamp the tenant and reject a foreign one.
  if (CREATE_OPERATIONS.has(operation)) {
    if (operation === 'upsert') {
      assertNoForeignFirmId(a.create, firmId);
      assertNoForeignFirmId(a.update, firmId);
      if (isTenant) a.create = injectFirmId(a.create, firmId);
    } else if (operation === 'createMany') {
      assertNoForeignFirmId(a.data, firmId);
      if (isTenant) a.data = injectFirmId(a.data, firmId);
    } else {
      assertNoForeignFirmId(a.data, firmId);
      if (isTenant) a.data = injectFirmId(a.data, firmId);
    }
  }

  return { operation: effectiveOperation, args: a, scoped: true };
}

/**
 * Returns a Prisma client scoped to one firm. This is the ONLY client
 * application code is allowed to use.
 */
export function forTenant(firmId: string) {
  if (!firmId) throw internal('Tenant context missing');

  return basePrisma.$extends({
    query: {
      $allModels: {
        async $allOperations(params) {
          // Prisma's $allOperations generics collapse to `never` for the
          // catch-all case, so the shape is asserted once here.
          const { model, operation, args, query } = params as unknown as {
            model?: string;
            operation: string;
            args: Record<string, unknown>;
            query: (args: unknown) => Promise<unknown>;
          };

          if (!model) return query(args);

          const scope = applyTenantScope({ model, operation, args, firmId });
          if (!scope.scoped) return query(args);

          // Run the query inside a transaction that also sets the RLS variable.
          //
          // This is what joins the two isolation layers. Without it the
          // extension filters correctly but `app.firm_id` is never set, so
          // every RLS policy fails closed and nothing works — which is exactly
          // what the database should do when the tenant is unknown.
          //
          // set_config(..., true) is transaction-local, so a pooled connection
          // handed to the next request cannot inherit a stale tenant (R-15).
          // Cost is one extra round trip per query; at this scale that is a
          // price worth paying for an isolation guarantee that cannot be
          // forgotten at a call site.
          return runInTenantTransaction(firmId, model, scope.operation, scope.args);
        },
      },
    },
  });
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

type AnyDelegate = Record<string, (args: unknown) => Promise<unknown>>;

/**
 * Dispatches one already-filtered operation inside a transaction carrying the
 * tenant id, so the RLS policies can evaluate.
 */
async function runInTenantTransaction(
  firmId: string,
  model: string,
  operation: string,
  args: unknown,
): Promise<unknown> {
  return basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.firm_id', ${firmId}::text, true)`;
    const delegates = tx as unknown as Record<string, AnyDelegate>;
    const delegate = delegates[lowerFirst(model)];
    const fn = delegate?.[operation];
    if (typeof fn !== 'function') {
      throw internal(`Unsupported operation ${model}.${operation}`);
    }
    return fn(args);
  });
}

/**
 * Runs `fn` inside a transaction that also sets the RLS tenant variable.
 *
 * `set_config(..., true)` is TRANSACTION-local, so a pooled connection handed to
 * another request cannot inherit a stale tenant id. Risk R-15 is closed by this
 * plus the concurrency test in F-01.
 */
export async function withTenant<T>(
  firmId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  return basePrisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.firm_id', ${firmId}::text, true)`;
      return fn(tx);
    },
    { timeout: options?.timeoutMs ?? 15_000 },
  );
}

/**
 * For the handful of operations that legitimately run before a tenant is known
 * (login by email, accepting an invitation, redeeming a reset token). These
 * take an explicit justification argument so they are greppable in review.
 */
export async function withoutTenant<T>(
  justification:
    | 'login-lookup'
    | 'invitation-redeem'
    | 'password-reset-redeem'
    | 'refresh-token-lookup'
    | 'platform-catalog'
    | 'startup-check',
  fn: (db: typeof basePrisma) => Promise<T>,
): Promise<T> {
  void justification;
  return fn(basePrisma);
}
