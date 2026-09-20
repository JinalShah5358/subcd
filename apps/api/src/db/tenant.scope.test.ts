import { describe, expect, it } from 'vitest';

import { HYBRID_MODELS, SELF_MODELS, TENANT_MODELS, applyTenantScope } from './tenant';

/**
 * F-01, layer 2: the tenant predicate reaches every operation on every model.
 *
 * Layer 1 proves each model is classified. This proves the classification is
 * acted on — for all 21 scoped models across all 15 operations, rather than
 * for whichever one a hand-written test happened to pick. Isolation that holds
 * for `findMany` and leaks through `groupBy` is not isolation.
 */

const FIRM = '01a0be56-9553-7308-8b22-cf0e04d3980a';
const OTHER = '01a00000-0000-7000-8000-000000000000';

const READS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
] as const;

const BULK_WRITES = ['updateMany', 'deleteMany'] as const;
const SINGLE_WRITES = ['update', 'delete'] as const;
const CREATES = ['create', 'createMany'] as const;

const SCOPED = [...TENANT_MODELS, ...HYBRID_MODELS, ...SELF_MODELS];

/** Walks a where-clause looking for the tenant predicate at any depth. */
function findsTenantPredicate(where: unknown, key: string, firmId: string): boolean {
  if (!where || typeof where !== 'object') return false;
  if (Array.isArray(where)) return where.some((w) => findsTenantPredicate(w, key, firmId));

  const obj = where as Record<string, unknown>;
  if (obj[key] === firmId) return true;
  if (Array.isArray(obj.AND)) return obj.AND.some((w) => findsTenantPredicate(w, key, firmId));
  if (Array.isArray(obj.OR)) return obj.OR.some((w) => findsTenantPredicate(w, key, firmId));
  return false;
}

const tenantKeyFor = (model: string) => (SELF_MODELS.has(model) ? 'id' : 'firmId');

describe('applyTenantScope — reads', () => {
  it.each(SCOPED)('%s: every read operation is filtered by tenant', (model) => {
    for (const operation of READS) {
      const { args, scoped } = applyTenantScope({
        model,
        operation,
        args: {},
        firmId: FIRM,
      });

      expect(scoped, `${model}.${operation} was not scoped at all`).toBe(true);
      expect(
        findsTenantPredicate(args.where, tenantKeyFor(model), FIRM),
        `${model}.${operation} has no tenant predicate in its where`,
      ).toBe(true);
    }
  });

  it.each(SCOPED)('%s: a caller-supplied where survives alongside the predicate', (model) => {
    const { args } = applyTenantScope({
      model,
      operation: 'findMany',
      args: { where: { deletedAt: null } },
      firmId: FIRM,
    });

    const and = (args.where as { AND: unknown[] }).AND;
    expect(and).toHaveLength(2);
    expect(and[0]).toEqual({ deletedAt: null });
    expect(findsTenantPredicate(args.where, tenantKeyFor(model), FIRM)).toBe(true);
  });

  it.each(SCOPED)('%s: findUnique is re-issued as findFirst so the predicate survives', (model) => {
    // Prisma rejects a compound AND in a findUnique where, so a scoped
    // findUnique MUST change operation or the tenant filter is dropped.
    expect(
      applyTenantScope({ model, operation: 'findUnique', args: { where: { id: 'x' } }, firmId: FIRM })
        .operation,
    ).toBe('findFirst');

    expect(
      applyTenantScope({
        model,
        operation: 'findUniqueOrThrow',
        args: { where: { id: 'x' } },
        firmId: FIRM,
      }).operation,
    ).toBe('findFirstOrThrow');
  });
});

describe('applyTenantScope — writes', () => {
  it.each(SCOPED)('%s: bulk writes are filtered by tenant', (model) => {
    for (const operation of BULK_WRITES) {
      const { args } = applyTenantScope({
        model,
        operation,
        args: { where: { id: 'x' }, data: {} },
        firmId: FIRM,
      });
      expect(
        findsTenantPredicate(args.where, tenantKeyFor(model), FIRM),
        `${model}.${operation} could reach another firm's rows`,
      ).toBe(true);
    }
  });

  it.each(SCOPED)('%s: single-row writes carry the tenant as a sibling key', (model) => {
    for (const operation of SINGLE_WRITES) {
      const { args } = applyTenantScope({
        model,
        operation,
        args: { where: { id: 'x' }, data: {} },
        firmId: FIRM,
      });

      // Not an AND wrapper: Prisma demands a unique selector here, and an AND
      // would be rejected outright.
      const where = args.where as Record<string, unknown>;
      expect(where.AND, `${model}.${operation} must not wrap where in AND`).toBeUndefined();
      expect(where[tenantKeyFor(model)]).toBe(FIRM);

      if (SELF_MODELS.has(model)) {
        // On the firm row the tenant key IS the id, so a supplied id is
        // overwritten rather than sat alongside. The caller cannot aim an
        // update at another firm: it is retargeted to their own.
        expect(where.id).toBe(FIRM);
      } else {
        // Elsewhere the id stays and the tenant joins it, so a row belonging
        // to another firm matches nothing at all.
        expect(where.id).toBe('x');
      }
    }
  });

  it.each([...TENANT_MODELS])('%s: creates are stamped with the tenant', (model) => {
    const single = applyTenantScope({
      model,
      operation: 'create',
      args: { data: { name: 'x' } },
      firmId: FIRM,
    });
    expect((single.args.data as Record<string, unknown>).firmId).toBe(FIRM);

    const many = applyTenantScope({
      model,
      operation: 'createMany',
      args: { data: [{ name: 'a' }, { name: 'b' }] },
      firmId: FIRM,
    });
    for (const row of many.args.data as Array<Record<string, unknown>>) {
      expect(row.firmId).toBe(FIRM);
    }
  });

  it.each([...TENANT_MODELS])('%s: a foreign firmId in the payload is refused', (model) => {
    for (const operation of CREATES) {
      const data = operation === 'createMany' ? [{ firmId: OTHER }] : { firmId: OTHER };
      expect(
        () => applyTenantScope({ model, operation, args: { data }, firmId: FIRM }),
        `${model}.${operation} accepted a write aimed at another firm`,
      ).toThrow();
    }

    expect(() =>
      applyTenantScope({
        model,
        operation: 'upsert',
        args: { where: { id: 'x' }, create: { firmId: OTHER }, update: {} },
        firmId: FIRM,
      }),
    ).toThrow();

    expect(() =>
      applyTenantScope({
        model,
        operation: 'upsert',
        args: { where: { id: 'x' }, create: {}, update: { firmId: OTHER } },
        firmId: FIRM,
      }),
    ).toThrow();
  });
});

describe('applyTenantScope — per-class behaviour', () => {
  it.each([...HYBRID_MODELS])('%s: reads see the firm rows and the shared ones', (model) => {
    const { args } = applyTenantScope({ model, operation: 'findMany', args: {}, firmId: FIRM });
    const and = (args.where as { AND: Array<Record<string, unknown>> }).AND;
    // A shared catalog row has firmId null and belongs to everyone; a firm's
    // own additions belong only to it.
    expect(and[1]).toEqual({ OR: [{ firmId: FIRM }, { firmId: null }] });
  });

  it.each([...TENANT_MODELS])('%s: reads never admit a null firmId', (model) => {
    const { args } = applyTenantScope({ model, operation: 'findMany', args: {}, firmId: FIRM });
    expect(JSON.stringify(args.where)).not.toContain('null');
  });

  it('refuses to mint a firm through a firm-scoped client', () => {
    for (const operation of ['create', 'createMany', 'upsert']) {
      expect(
        () => applyTenantScope({ model: 'Firm', operation, args: { data: {} }, firmId: FIRM }),
        `Firm.${operation} should be a platform operation, not a tenant one`,
      ).toThrow();
    }
  });

  it('scopes the firm row by its own id, not by a firmId column', () => {
    const { args } = applyTenantScope({ model: 'Firm', operation: 'findFirst', args: {}, firmId: FIRM });
    expect(findsTenantPredicate(args.where, 'id', FIRM)).toBe(true);
    expect(JSON.stringify(args.where)).not.toContain('firmId');
  });

  it('leaves an unclassified catalog model alone', () => {
    const result = applyTenantScope({
      model: 'District',
      operation: 'findMany',
      args: {},
      firmId: FIRM,
    });
    expect(result.scoped).toBe(false);
    expect(result.args.where).toBeUndefined();
  });

  it('refuses to scope anything without a tenant', () => {
    expect(() =>
      applyTenantScope({ model: 'Client', operation: 'findMany', args: {}, firmId: '' }),
    ).toThrow();
  });
});
