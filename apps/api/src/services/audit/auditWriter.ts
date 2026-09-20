import type { Prisma } from '@prisma/client';
import { uuidv7, type AuditAction } from '@ifp/shared';
import { withTenant } from '../../db/tenant';
import { tryGetContext } from '../../auth/context';
import { logger } from '../../utils/logger';

/**
 * Audit metadata allow-list.
 *
 * Only these keys survive into the audit row. Anything else is dropped, so a
 * careless `metadata: { ...client }` cannot smuggle a PAN into the audit trail.
 * Adding a key here is a deliberate act that should be reviewed.
 */
const METADATA_ALLOW_LIST = new Set([
  'caseNumber',
  'clientName',
  'fromStatus',
  'toStatus',
  'roleKey',
  'previousRoleKey',
  'severity',
  'ruleCode',
  'findingCount',
  'blockingCount',
  'warningCount',
  'documentTypeCode',
  'slotStatus',
  'field',
  'fieldCount',
  'rowCount',
  'templateVersion',
  'consentMethod',
  'reason',
  'trigger',
  'readinessScore',
  'section',
  'invitedEmail',
  'targetUserId',
  'durationMs',
  'source',

  // Platform administration. Names and reasons, never tenant data.
  'slug',
  'from',
  'to',
  'provisionedBy',
  'changedBy',

  // Extension. Counts, outcomes and structural digests — no field values.
  'via',
  'label',
  'agentVersion',
  'ttlMinutes',
  'formCode',
  'refusedCount',
  'fingerprint',
  'sessionId',
  'attempted',
  'filled',
  'failed',
  'driftDetected',
  'pathCount',
  'sourcePath',
  // Recorded on every autofill run, always false. An audit trail that states
  // it plainly is worth more than a policy document that claims it.
  'submitted',
]);

/** Values are stringified and length-capped; objects are rejected outright. */
function sanitizeMetadata(input: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (!input) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!METADATA_ALLOW_LIST.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value.length > 200 ? `${value.slice(0, 197)}...` : value;
    }
    // objects / arrays are deliberately dropped
  }
  return Object.keys(out).length ? out : undefined;
}

export interface AuditInput {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  outcome?: 'SUCCESS' | 'FAILURE' | 'DENIED';
  failureReason?: string;
  /** Field NAMES only. A test asserts no value ever appears here. */
  changedFields?: string[];
  metadata?: Record<string, unknown>;
  /** Overrides for paths that run before/outside a request context. */
  firmId?: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRoleKey?: string | null;
}

/**
 * Writes one audit row. Uses the base client because audit rows are written for
 * the tenant identified in the input, and the table is INSERT/SELECT-only for
 * the application role at the database level.
 *
 * Never throws into the caller: losing an audit row must not fail a user's
 * action, but it must be loudly logged.
 */
export async function writeAudit(input: AuditInput, tx?: Prisma.TransactionClient): Promise<void> {
  const ctx = tryGetContext();
  const firmId = input.firmId ?? ctx?.auth?.firmId;

  if (!firmId) {
    logger.error({ action: input.action }, 'audit row dropped — no firm context');
    return;
  }

  const data: Prisma.AuditLogUncheckedCreateInput = {
    id: uuidv7(),
    firmId,
    actorUserId: input.actorUserId ?? ctx?.auth?.userId ?? null,
    actorEmailSnapshot: input.actorEmail ?? ctx?.auth?.email ?? null,
    actorRoleSnapshot: input.actorRoleKey ?? ctx?.auth?.roleKey ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    clientType: (ctx?.clientType ?? 'SYSTEM') as Prisma.AuditLogUncheckedCreateInput['clientType'],
    outcome: input.outcome ?? 'SUCCESS',
    failureReason: input.failureReason ?? null,
    ipAddress: ctx?.ip ?? null,
    userAgent: ctx?.userAgent?.slice(0, 500) ?? null,
    requestId: ctx?.requestId ?? 'system',
    changedFields: input.changedFields ?? [],
  };

  const metadata = sanitizeMetadata(input.metadata);
  if (metadata !== undefined) data.metadata = metadata;

  try {
    if (tx) await tx.auditLog.create({ data });
    else await withTenant(firmId, (t) => t.auditLog.create({ data }));
  } catch (err) {
    logger.error(
      { err, action: input.action, entityType: input.entityType },
      'failed to write audit row',
    );
  }
}

/**
 * Diffs two objects and returns the NAMES of fields that changed.
 * Values are compared but never returned — that is the entire point.
 */
export function changedFieldNames(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
): string[] {
  if (!before) return Object.keys(after);
  const names: string[] = [];
  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    const prev = before[key];
    const a = prev instanceof Date ? prev.toISOString() : prev;
    const b = value instanceof Date ? value.toISOString() : value;
    if (String(a ?? '') !== String(b ?? '')) names.push(key);
  }
  return names;
}
