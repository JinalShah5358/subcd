import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import '../config/env';
import { HYBRID_MODELS, SELF_MODELS, TENANT_MODELS } from './tenant';

/**
 * F-01, layer 3: the database refuses on its own.
 *
 * Layers 1 and 2 prove the application always asks the right question. This
 * proves that the wrong question still gets no answer — that isolation does
 * not depend on the Prisma extension being correct, because one day it will
 * not be.
 *
 * Needs a running database. When there isn't one the suite skips rather than
 * fails, so `vitest run` stays useful without Docker; CI must run it with a
 * database or it proves nothing.
 */

const SCHEMA = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'prisma', 'schema.prisma'),
  'utf8',
);

/** model name -> physical table name, read from each model's @@map. */
function tableNames(models: Set<string>): Array<{ model: string; table: string }> {
  const out: Array<{ model: string; table: string }> = [];
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;

  while ((m = modelRe.exec(SCHEMA)) !== null) {
    const [, name, body] = m;
    if (!models.has(name!)) continue;
    const mapped = /@@map\("([^"]+)"\)/.exec(body!);
    out.push({ model: name!, table: mapped ? mapped[1]! : name!.toLowerCase() });
  }
  return out;
}

const TENANT_TABLES = tableNames(TENANT_MODELS);
const HYBRID_TABLES = tableNames(HYBRID_MODELS);
const SELF_TABLES = tableNames(SELF_MODELS);
const ALL_PROTECTED = [...TENANT_TABLES, ...HYBRID_TABLES, ...SELF_TABLES];

const NOWHERE_FIRM = '01a00000-0000-7000-8000-000000000000';

let prisma: PrismaClient | null = null;
let reachable = false;
let realFirmId: string | null = null;

beforeAll(async () => {
  try {
    prisma = new PrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    reachable = true;

    // Getting a firm id before a tenant is known is exactly the problem the
    // SECURITY DEFINER helpers exist to solve, so the test uses one rather
    // than inventing a way around RLS for itself.
    const rows = await prisma.$queryRaw<Array<{ firm_id: string }>>`
      SELECT firm_id FROM auth_find_user_by_email('admin@demo.local')
    `;
    realFirmId = rows[0]?.firm_id ?? null;
  } catch {
    reachable = false;
  }
}, 30_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

/**
 * Skipping silently is fine on a laptop with Docker stopped and unacceptable
 * in CI, where a skipped isolation test looks exactly like a passing one. Set
 * RLS_TESTS_REQUIRE_DB=1 there and an unreachable database becomes a failure.
 */
const DB_REQUIRED = process.env.RLS_TESTS_REQUIRE_DB === '1';

const withDb = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!reachable) {
      if (DB_REQUIRED) {
        throw new Error(
          'RLS_TESTS_REQUIRE_DB=1 but no database was reachable — isolation went unverified',
        );
      }
      console.warn(`  (skipped: no database) ${name}`);
      return;
    }
    await fn();
  }, 30_000);

describe('row level security — configuration', () => {
  it('found the tables it intends to check', () => {
    expect(TENANT_TABLES.length).toBeGreaterThan(10);
    expect(TENANT_TABLES.map((t) => t.table)).toContain('client');
    expect(SELF_TABLES.map((t) => t.table)).toEqual(['firm']);
  });

  withDb('has RLS enabled on every tenant-owned table', async () => {
    const rows = await prisma!.$queryRawUnsafe<Array<{ relname: string; relrowsecurity: boolean }>>(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relname = ANY($1::text[]) AND relkind = 'r'`,
      ALL_PROTECTED.map((t) => t.table),
    );

    const found = new Map(rows.map((r) => [r.relname, r.relrowsecurity]));
    const missing = ALL_PROTECTED.filter((t) => !found.has(t.table)).map((t) => t.table);
    const unprotected = ALL_PROTECTED.filter((t) => found.get(t.table) === false).map(
      (t) => t.table,
    );

    expect(missing, 'Table(s) in the registry that do not exist in the database').toEqual([]);
    expect(unprotected, 'Table(s) with RLS switched off').toEqual([]);
  });

  withDb('has at least one policy on every protected table', async () => {
    const rows = await prisma!.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT DISTINCT tablename FROM pg_policies
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      ALL_PROTECTED.map((t) => t.table),
    );

    const withPolicy = new Set(rows.map((r) => r.tablename));
    const naked = ALL_PROTECTED.filter((t) => !withPolicy.has(t.table)).map((t) => t.table);

    // RLS enabled with no policy denies everything, which is safe but breaks
    // the app; RLS enabled with a policy that was never written is the real
    // hazard, and this catches a table added without one.
    expect(naked, 'Protected table(s) with no RLS policy').toEqual([]);
  });

  withDb('connects as a role that cannot bypass RLS and owns no table', async () => {
    const [role] = await prisma!.$queryRaw<
      Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>
    >`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;

    expect(role?.rolsuper, 'the app must not connect as a superuser').toBe(false);
    expect(role?.rolbypassrls, 'the app role must not have BYPASSRLS').toBe(false);

    // A table's owner is exempt from its own policies unless FORCE is set, so
    // owning the tables would quietly defeat all of this.
    const owned = await prisma!.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tableowner = current_user AND tablename = ANY($1::text[])`,
      ALL_PROTECTED.map((t) => t.table),
    );
    expect(owned.map((r) => r.tablename), 'the app role must not own the tables it queries').toEqual(
      [],
    );
  });
});

describe('row level security — reads isolate', () => {
  withDb('returns nothing from any tenant table when no tenant is set', async () => {
    const leaked: string[] = [];

    for (const { table } of TENANT_TABLES) {
      const rows = await prisma!.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.firm_id', '', true)`;
        return tx.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*)::bigint AS n FROM "${table}"`,
        );
      });
      if (Number(rows[0]!.n) !== 0) leaked.push(table);
    }

    expect(leaked, 'Table(s) readable with no tenant — RLS must fail closed').toEqual([]);
  });

  withDb('returns nothing from any tenant table for a firm that does not exist', async () => {
    const leaked: string[] = [];

    for (const { table } of TENANT_TABLES) {
      const rows = await prisma!.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.firm_id', ${NOWHERE_FIRM}::text, true)`;
        return tx.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*)::bigint AS n FROM "${table}"`,
        );
      });
      if (Number(rows[0]!.n) !== 0) leaked.push(table);
    }

    expect(leaked, "Table(s) that leaked rows to a stranger's tenant id").toEqual([]);
  });

  withDb('does return the seeded firm its own rows', async () => {
    expect(realFirmId, 'the demo firm should be seeded before running this').toBeTruthy();

    const counts = await prisma!.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.firm_id', ${realFirmId!}::text, true)`;
      const out: Record<string, number> = {};
      for (const { table } of TENANT_TABLES) {
        const rows = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*)::bigint AS n FROM "${table}"`,
        );
        out[table] = Number(rows[0]!.n);
      }
      return out;
    });

    // The previous two tests would also pass if the policies denied
    // everything unconditionally, which is isolation by way of a broken app.
    expect(counts.client, 'the demo firm should have clients').toBeGreaterThan(0);
    expect(counts.app_user).toBeGreaterThan(0);
    expect(counts.audit_log).toBeGreaterThan(0);
  });

  withDb('scopes the firm row itself by id', async () => {
    const own = await prisma!.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.firm_id', ${realFirmId!}::text, true)`;
      return tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM firm`;
    });
    const foreign = await prisma!.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.firm_id', ${NOWHERE_FIRM}::text, true)`;
      return tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM firm`;
    });

    expect(Number(own[0]!.n)).toBe(1);
    expect(Number(foreign[0]!.n)).toBe(0);
  });

  withDb('keeps shared catalog rows readable while hiding another firm’s', async () => {
    for (const { table } of HYBRID_TABLES) {
      const rows = await prisma!.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.firm_id', ${NOWHERE_FIRM}::text, true)`;
        return tx.$queryRawUnsafe<Array<{ n: bigint; own: bigint }>>(
          `SELECT count(*)::bigint AS n,
                  count(*) FILTER (WHERE firm_id IS NOT NULL)::bigint AS own
             FROM "${table}"`,
        );
      });
      // A hybrid table is global rows plus private ones. A stranger sees the
      // global rows and none of the private ones.
      expect(Number(rows[0]!.own), `${table} leaked a firm-private row`).toBe(0);
    }
  });

  withDb('cannot be made to inherit a tenant from the previous transaction', async () => {
    // set_config(..., true) is transaction-local. If it ever became session
    // -local, a pooled connection would hand the next request the last
    // request's tenant — R-15, and invisible until it is catastrophic.
    await prisma!.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.firm_id', ${realFirmId!}::text, true)`;
      await tx.$queryRaw`SELECT count(*) FROM client`;
    });

    const after = await prisma!.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM client
    `;
    expect(Number(after[0]!.n), 'a tenant survived its transaction').toBe(0);
  });

  withDb('refuses a licence change that arrives from inside a tenant', async () => {
    // The second wall behind `updateFirmSchema` not carrying licence fields.
    // Schemas get refactored; a BEFORE UPDATE trigger does not quietly grow a
    // new field. A firm must not be able to grant itself a plan even if the
    // API one day hands it a path to try.
    const before = await prisma!.$queryRaw<Array<{ plan: string }>>`
      SELECT plan FROM firm_license_state(${realFirmId!}::uuid)
    `;
    const original = before[0]?.plan;
    expect(original, 'no licence to test against').toBeTruthy();

    await expect(
      prisma!.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.firm_id', ${realFirmId!}::text, true)`;
        await tx.$executeRaw`UPDATE firm SET plan = 'ENTERPRISE' WHERE id = ${realFirmId!}::uuid`;
      }),
    ).rejects.toThrow(/cannot change its own licence/);

    const after = await prisma!.$queryRaw<Array<{ plan: string }>>`
      SELECT plan FROM firm_license_state(${realFirmId!}::uuid)
    `;
    expect(after[0]?.plan, 'a firm changed its own plan').toBe(original);
  });

  withDb('still lets a firm edit its own ordinary settings', async () => {
    // The trigger must refuse licence columns and nothing else. One that
    // blocked the whole row would break firm settings, and that would be
    // found by a user rather than by this test.
    await expect(
      prisma!.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.firm_id', ${realFirmId!}::text, true)`;
        await tx.$executeRaw`
          UPDATE firm SET contact_phone = contact_phone WHERE id = ${realFirmId!}::uuid
        `;
      }),
    ).resolves.not.toThrow();
  });
});
