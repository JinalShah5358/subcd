import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/** Load .env from the repo root, wherever the process was started from. */
function loadEnvFile(): void {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
loadEnvFile();

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  /** Comma-separated chrome-extension://<id> origins. Required in production. */
  EXTENSION_ORIGINS: z.string().optional(),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_DIRECT_URL: z.string().optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ALG: z.enum(['HS256']).default('HS256'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(120).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  REFRESH_IDLE_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),

  KMS_MODE: z.enum(['local']).default('local'),
  KMS_LOCAL_MASTER_KEY: z
    .string()
    .min(1, 'KMS_LOCAL_MASTER_KEY is required')
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'KMS_LOCAL_MASTER_KEY must be 32 bytes, base64 encoded'),
  BLIND_INDEX_PEPPER: z.string().min(16, 'BLIND_INDEX_PEPPER is required'),

  MAIL_TRANSPORT: z.enum(['smtp', 'console']).default('console'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('IFP Platform <no-reply@localhost>'),

  RATE_LIMIT_ENABLED: bool(true),
  FEATURE_AADHAAR_FULL_STORAGE: bool(false),
  FEATURE_DOCUMENT_UPLOADS: bool(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and name the variable. Never print values.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nConfiguration error — the API cannot start:\n${issues}\n\nCopy .env.example to .env and fill it in.\n`);
  process.exit(1);
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Aadhaar full-number storage is off at three independent layers: this flag, the
 * absence of any write path, and a database CHECK constraint. See ADR-013.
 */
if (env.FEATURE_AADHAAR_FULL_STORAGE) {
  // eslint-disable-next-line no-console
  console.error(
    'FEATURE_AADHAAR_FULL_STORAGE is enabled but the database CHECK constraint still blocks it. ' +
      'Enabling requires a documented legal decision (XC-002) and a reviewed migration. Refusing to start.',
  );
  process.exit(1);
}
