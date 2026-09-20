import { describe, expect, it } from 'vitest';

import {
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  afterFailedAttempt,
  afterSuccessfulAttempt,
  isLocked,
} from './lockout';

const AT = new Date('2026-09-20T10:00:00.000Z');
const MINUTE = 60_000;

describe('isLocked', () => {
  it('is not locked when nothing is recorded', () => {
    expect(isLocked(null, AT)).toBe(false);
    expect(isLocked(undefined, AT)).toBe(false);
  });

  it('is locked while the window is still open', () => {
    expect(isLocked(new Date(AT.getTime() + MINUTE), AT)).toBe(true);
  });

  it('is not locked once the window has passed', () => {
    expect(isLocked(new Date(AT.getTime() - MINUTE), AT)).toBe(false);
  });

  it('is not locked at the exact instant the window closes', () => {
    // Strictly greater-than: a boundary that locks forever at equality would
    // be a bad place to be wrong.
    expect(isLocked(new Date(AT.getTime()), AT)).toBe(false);
  });

  it('accepts the ISO string the database hands back', () => {
    expect(isLocked(new Date(AT.getTime() + MINUTE).toISOString(), AT)).toBe(true);
    expect(isLocked(new Date(AT.getTime() - MINUTE).toISOString(), AT)).toBe(false);
  });
});

describe('afterFailedAttempt', () => {
  it('counts up without locking below the limit', () => {
    for (let current = 0; current < MAX_FAILED_LOGINS - 1; current += 1) {
      const next = afterFailedAttempt(current, AT);
      expect(next.failedLoginCount).toBe(current + 1);
      expect(next.lockedUntil, `locked after only ${current + 1} failure(s)`).toBeNull();
    }
  });

  it('locks exactly on the limit, not before', () => {
    const justUnder = afterFailedAttempt(MAX_FAILED_LOGINS - 2, AT);
    expect(justUnder.lockedUntil).toBeNull();

    const atLimit = afterFailedAttempt(MAX_FAILED_LOGINS - 1, AT);
    expect(atLimit.failedLoginCount).toBe(MAX_FAILED_LOGINS);
    expect(atLimit.lockedUntil).toEqual(new Date(AT.getTime() + LOCKOUT_MINUTES * MINUTE));
  });

  it('keeps locking past the limit', () => {
    const past = afterFailedAttempt(MAX_FAILED_LOGINS + 3, AT);
    expect(past.lockedUntil).not.toBeNull();
  });

  it('starts the window from now, not from the first failure', () => {
    const later = new Date(AT.getTime() + 60 * MINUTE);
    const next = afterFailedAttempt(MAX_FAILED_LOGINS - 1, later);
    expect(next.lockedUntil).toEqual(new Date(later.getTime() + LOCKOUT_MINUTES * MINUTE));
  });

  it('honours caller-supplied thresholds', () => {
    const next = afterFailedAttempt(2, AT, 3, 5);
    expect(next.failedLoginCount).toBe(3);
    expect(next.lockedUntil).toEqual(new Date(AT.getTime() + 5 * MINUTE));
  });

  /**
   * Documents a real consequence rather than asserting it is ideal.
   *
   * The counter is cleared only by a SUCCESSFUL sign-in, so a user who waits
   * out a lockout and then mistypes once is locked out again immediately —
   * effectively one attempt per window, indefinitely. That is deliberate
   * against credential stuffing, but it means password reset must stay
   * reachable while locked, because it is the only way back in.
   */
  it('re-locks immediately on the first failure after a lockout expires', () => {
    const afterExpiry = new Date(AT.getTime() + (LOCKOUT_MINUTES + 1) * MINUTE);
    const next = afterFailedAttempt(MAX_FAILED_LOGINS, afterExpiry);

    expect(next.failedLoginCount).toBe(MAX_FAILED_LOGINS + 1);
    expect(next.lockedUntil).toEqual(
      new Date(afterExpiry.getTime() + LOCKOUT_MINUTES * MINUTE),
    );
  });
});

describe('afterSuccessfulAttempt', () => {
  it('clears both the counter and the lock', () => {
    expect(afterSuccessfulAttempt()).toEqual({ failedLoginCount: 0, lockedUntil: null });
  });

  it('is the only thing that resets the counter', () => {
    // Four failures, then a success, then a failure: the user must be back at
    // one, not at five.
    let state = { failedLoginCount: 0, lockedUntil: null as Date | null };
    for (let i = 0; i < 4; i += 1) state = afterFailedAttempt(state.failedLoginCount, AT);
    expect(state.failedLoginCount).toBe(4);

    state = afterSuccessfulAttempt();
    state = afterFailedAttempt(state.failedLoginCount, AT);

    expect(state.failedLoginCount).toBe(1);
    expect(state.lockedUntil).toBeNull();
  });

  it('gives a locked-out user a full five attempts again', () => {
    let count = MAX_FAILED_LOGINS;
    expect(afterFailedAttempt(count, AT).lockedUntil).not.toBeNull();

    count = afterSuccessfulAttempt().failedLoginCount;
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i += 1) {
      const next = afterFailedAttempt(count, AT);
      expect(next.lockedUntil).toBeNull();
      count = next.failedLoginCount;
    }
    expect(afterFailedAttempt(count, AT).lockedUntil).not.toBeNull();
  });
});
