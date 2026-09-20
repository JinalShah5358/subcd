/**
 * Account lockout after repeated failed sign-ins.
 *
 * Pulled out of the login handler so the policy can be exercised directly.
 * Lockout is easy to get subtly wrong in ways nobody notices until either an
 * attacker is not slowed down or a real user is locked out of their own case
 * files, and neither shows up in a happy-path test.
 */

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export interface LockoutState {
  failedLoginCount: number;
  lockedUntil: Date | null;
}

/** Is this account currently locked? */
export function isLocked(lockedUntil: Date | string | null | undefined, now = new Date()): boolean {
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > now.getTime();
}

/**
 * The state to persist after a failed attempt.
 *
 * Note the behaviour once the counter has reached the limit: the count keeps
 * climbing and each further failure starts a fresh window. A user who lets a
 * lockout expire and then mistypes once is locked out again immediately,
 * because the counter is only cleared by a *successful* sign-in. That is
 * deliberate against credential stuffing, and it is also the reason password
 * reset has to stay reachable while locked — it is the only way back.
 */
export function afterFailedAttempt(
  currentCount: number,
  now = new Date(),
  maxFailed: number = MAX_FAILED_LOGINS,
  lockoutMinutes: number = LOCKOUT_MINUTES,
): LockoutState {
  const failedLoginCount = currentCount + 1;
  return {
    failedLoginCount,
    lockedUntil:
      failedLoginCount >= maxFailed
        ? new Date(now.getTime() + lockoutMinutes * 60_000)
        : null,
  };
}

/** The state to persist after a successful sign-in. */
export function afterSuccessfulAttempt(): LockoutState {
  return { failedLoginCount: 0, lockedUntil: null };
}
