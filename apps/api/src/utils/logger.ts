import pino from 'pino';
import { env, isProd } from '../config/env';

/**
 * Redaction allow-list. Anything matching these paths is replaced before the
 * line reaches a sink. The audit canary test (F-04) feeds fake PAN / Aadhaar /
 * account values through every logged path and fails the build if one survives.
 *
 * Note this is belt-and-braces: application code must not put sensitive values
 * into log objects in the first place.
 */
const REDACT_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'authorization',
  'cookie',
  'pan',
  'gstin',
  'udyam',
  'aadhaar',
  'aadhaarLast4',
  'loanAccountNo',
  'secret',
  'dek',
  'wrappedDek',
  '*.password',
  '*.pan',
  '*.gstin',
  '*.udyam',
  '*.loanAccountNo',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.pan',
  'req.body.gstin',
  'req.body.udyam',
  'req.body.loanAccountNo',
  'res.headers["set-cookie"]',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  base: { service: 'ifp-api' },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }),
});

export type Logger = typeof logger;

/** Strings we must never see in a log line or audit row. Used by the canary test. */
export const SENSITIVE_PATTERNS: RegExp[] = [
  /\b[A-Z]{5}[0-9]{4}[A-Z]\b/, // PAN
  /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/, // GSTIN
  /\b[2-9][0-9]{11}\b/, // 12-digit Aadhaar-shaped number
];
