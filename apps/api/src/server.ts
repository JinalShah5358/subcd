import { createApp } from './app';
import { env } from './config/env';
import { assertRlsActive, disconnectPrisma } from './db/prisma';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  // Refuse to serve if the tenant-isolation backstop is not actually in force.
  await assertRlsActive();

  const app = createApp();
  const server = app.listen(env.API_PORT, () => {
    logger.info(
      { port: env.API_PORT, env: env.NODE_ENV, webOrigin: env.WEB_ORIGIN },
      `IFP API listening on http://localhost:${env.API_PORT}`,
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await disconnectPrisma();
      process.exit(0);
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
