import { hash, verify } from '@node-rs/argon2';
import { timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * Argon2id with OWASP-recommended parameters (2024): 19 MiB memory, 2 passes,
 * 1 lane. The encoded hash carries its own parameters, so raising them later
 * upgrades existing users transparently on their next login.
 */
const ARGON_OPTS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON_OPTS);
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    return await verify(stored, plain, ARGON_OPTS);
  } catch {
    return false;
  }
}

/**
 * Burns roughly the same CPU as a real verification. Called when the email does
 * not exist, so an attacker cannot distinguish "no such user" from "wrong
 * password" by timing.
 */
const DUMMY_HASH_PROMISE = hashPassword(randomBytes(24).toString('base64'));

export async function burnPasswordVerification(): Promise<void> {
  const dummy = await DUMMY_HASH_PROMISE;
  await verifyPassword('not-the-password', dummy);
}

/** Should the stored hash be upgraded to current parameters? */
export function needsRehash(stored: string): boolean {
  const m = /\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)/.exec(stored);
  if (!m) return true;
  const [, mem, time, par] = m;
  return (
    Number(mem) < ARGON_OPTS.memoryCost ||
    Number(time) < ARGON_OPTS.timeCost ||
    Number(par) < ARGON_OPTS.parallelism
  );
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
