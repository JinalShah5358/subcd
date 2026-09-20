import { PrismaClient } from '@prisma/client';
import { env, isProd } from '../config/env';
import { logger } from '../utils/logger';

/**
 * THE BASE CLIENT IS PRIVATE TO THIS DIRECTORY.
 *
 * Application code must never import this. It has no tenant filter and would
 * happily read every firm's data. Use `forTenant()` / `withTenant()` from
 * ./tenant instead — an ESLint no-restricted-imports rule enforces this.
 */
export const basePrisma = new PrismaClient({
  log: isProd
    ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
    : [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
});

basePrisma.$on('warn', (e) => logger.warn({ prisma: e.message }, 'prisma warning'));
basePrisma.$on('error', (e) => logger.error({ prisma: e.message }, 'prisma error'));

/**
 * Boot assertion: the application must NOT be connected as the table owner,
 * because an owner bypasses Row Level Security and our isolation backstop
 * would silently do nothing.
 */
export async function assertRlsActive(): Promise<void> {
  const rows = await basePrisma.$queryRaw<Array<{ current_user: string; is_superuser: boolean; bypassrls: boolean }>>`
    SELECT current_user::text            AS current_user,
           rolsuper                      AS is_superuser,
           rolbypassrls                  AS bypassrls
      FROM pg_roles
     WHERE rolname = current_user
  `;

  const row = rows[0];
  if (!row) throw new Error('Could not determine the database role at startup');

  if (row.is_superuser || row.bypassrls) {
    throw new Error(
      `The API is connected to Postgres as "${row.current_user}", which bypasses Row Level Security. ` +
        'Point DATABASE_URL at the unprivileged application role (ifp_app).',
    );
  }

  const owners = await basePrisma.$queryRaw<Array<{ owner: string }>>`
    SELECT tableowner AS owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'client'
  `;
  const owner = owners[0]?.owner;
  if (owner && owner === row.current_user) {
    throw new Error(
      `The API is connected as "${row.current_user}", which OWNS the tables and therefore bypasses RLS. ` +
        'Use the application role instead.',
    );
  }

  logger.info(
    { dbRole: row.current_user, tableOwner: owner },
    'RLS precondition satisfied — application role is not the table owner',
  );
}

export async function disconnectPrisma(): Promise<void> {
  await basePrisma.$disconnect();
}

export { env };
