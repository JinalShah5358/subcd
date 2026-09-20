import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F-02: refresh-token rotation and reuse detection.
 *
 * The behaviour under test is a security control, so the tests are written
 * against the failure modes rather than the happy path: a spent token, a
 * revoked token, an expired one, a disabled user, and — the one that actually
 * shipped broken — two requests presenting the same token at once.
 *
 * The database is mocked, but not vaguely: `updateMany` here behaves the way
 * Postgres behaves, matching only rows that still satisfy the where-clause and
 * reporting how many it touched. That is precisely the property the real code
 * depends on, so a change that stopped depending on it would fail here.
 */

const { state, findRefreshToken, withTenant, revokeFamilySpy } = vi.hoisted(() => {
  const state = {
    row: null as Record<string, unknown> | null,
    /** Simulates the row's persisted used_at/revoked_at. */
    usedAt: null as Date | null,
    revokedAt: null as Date | null,
    created: [] as Array<Record<string, unknown>>,
    familyRevocations: [] as Array<{ familyId: string; reason: string }>,
  };

  return {
    state,
    findRefreshToken: vi.fn(async () => state.row),
    revokeFamilySpy: vi.fn(),
    withTenant: vi.fn(async (_firmId: string, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        refreshToken: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            state.created.push(data);
            return data;
          },
          updateMany: async ({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            // Family-wide revocation.
            if (where.familyId !== undefined) {
              state.familyRevocations.push({
                familyId: String(where.familyId),
                reason: String(data.revokedReason),
              });
              state.revokedAt = new Date();
              return { count: 1 };
            }

            // The conditional claim. Postgres matches zero rows once the
            // predicate no longer holds; so does this.
            const matches =
              (where.usedAt !== undefined ? state.usedAt === null : true) &&
              (where.revokedAt !== undefined ? state.revokedAt === null : true);
            if (!matches) return { count: 0 };

            if (data.usedAt !== undefined) state.usedAt = data.usedAt as Date;
            if (data.revokedAt !== undefined) state.revokedAt = data.revokedAt as Date;
            return { count: 1 };
          },
        },
      };
      return fn(tx);
    }),
  };
});

vi.mock('./lookups', () => ({ findRefreshToken }));
vi.mock('../db/tenant', () => ({ withTenant }));
vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { hashToken, issueRefreshToken, rotateRefreshToken, revokeFamily } = await import('./tokens');

const FIRM = '01a0be56-9553-7308-8b22-cf0e04d3980a';
const USER = '01a0be56-9577-7ab5-992b-adb9446fab3e';
const FAMILY = '01a0be56-0000-7000-8000-000000000001';

const HOUR = 60 * 60 * 1000;

function seedToken(over: Record<string, unknown> = {}) {
  state.usedAt = (over.used_at as Date | null) ?? null;
  state.revokedAt = (over.revoked_at as Date | null) ?? null;
  state.row = {
    id: '01a0be56-0000-7000-8000-00000000000a',
    firm_id: FIRM,
    user_id: USER,
    family_id: FAMILY,
    client_type: 'WEB',
    used_at: null,
    revoked_at: null,
    expires_at: new Date(Date.now() + 24 * HOUR),
    user_status: 'ACTIVE',
    user_deleted: false,
    ...over,
  };
}

beforeEach(() => {
  state.row = null;
  state.usedAt = null;
  state.revokedAt = null;
  state.created = [];
  state.familyRevocations = [];
  vi.clearAllMocks();
  revokeFamilySpy.mockClear();
});

describe('issueRefreshToken', () => {
  it('stores only a hash, never the token itself', async () => {
    const raw = await issueRefreshToken({ userId: USER, firmId: FIRM });

    expect(state.created).toHaveLength(1);
    const stored = state.created[0]!;
    expect(stored.tokenHash).toBe(hashToken(raw));
    expect(JSON.stringify(stored)).not.toContain(raw);
  });

  it('issues a different token every time', async () => {
    const a = await issueRefreshToken({ userId: USER, firmId: FIRM });
    const b = await issueRefreshToken({ userId: USER, firmId: FIRM });
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(32);
  });

  it('hashes the user agent rather than storing it', async () => {
    await issueRefreshToken({
      userId: USER,
      firmId: FIRM,
      userAgent: 'Mozilla/5.0 (a very identifying string)',
    });
    const stored = state.created[0]!;
    expect(stored.userAgentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain('Mozilla');
  });

  it('writes through withTenant, so RLS is satisfied rather than bypassed', async () => {
    await issueRefreshToken({ userId: USER, firmId: FIRM });
    expect(withTenant).toHaveBeenCalledWith(FIRM, expect.any(Function));
  });
});

describe('rotateRefreshToken — the happy path', () => {
  it('spends the old token and issues a new one in the same family', async () => {
    seedToken();
    const result = await rotateRefreshToken('some-raw-token', {});

    expect(result.userId).toBe(USER);
    expect(result.firmId).toBe(FIRM);
    expect(result.rawToken).toBeTruthy();
    expect(state.usedAt, 'the presented token must be marked spent').not.toBeNull();
    expect(state.created).toHaveLength(1);
    expect(state.created[0]!.familyId, 'rotation stays within one family').toBe(FAMILY);
  });

  it('carries the client type across the rotation', async () => {
    seedToken({ client_type: 'EXTENSION' });
    await rotateRefreshToken('raw', {});
    expect(state.created[0]!.clientType).toBe('EXTENSION');
  });
});

describe('rotateRefreshToken — refusals', () => {
  it('refuses a token it has never seen', async () => {
    state.row = null;
    await expect(rotateRefreshToken('never-issued', {})).rejects.toThrow();
    expect(state.created).toHaveLength(0);
  });

  it('refuses an expired token without revoking the family', async () => {
    seedToken({ expires_at: new Date(Date.now() - HOUR) });
    await expect(rotateRefreshToken('raw', {})).rejects.toThrow();
    // Expiry is ordinary, not suspicious: signing in again should work.
    expect(state.familyRevocations).toHaveLength(0);
  });

  it('refuses and revokes everything for a disabled user', async () => {
    seedToken({ user_status: 'DISABLED' });
    await expect(rotateRefreshToken('raw', {})).rejects.toThrow();
    expect(state.familyRevocations).toEqual([{ familyId: FAMILY, reason: 'USER_INACTIVE' }]);
    expect(state.created).toHaveLength(0);
  });

  it('refuses and revokes everything for a deleted user', async () => {
    seedToken({ user_deleted: true });
    await expect(rotateRefreshToken('raw', {})).rejects.toThrow();
    expect(state.familyRevocations[0]?.reason).toBe('USER_INACTIVE');
  });
});

describe('rotateRefreshToken — reuse detection', () => {
  it('revokes the whole family when an already-spent token is presented', async () => {
    seedToken({ used_at: new Date(Date.now() - 60_000) });

    await expect(rotateRefreshToken('raw', {})).rejects.toThrow();

    expect(state.familyRevocations).toEqual([{ familyId: FAMILY, reason: 'REUSE_DETECTED' }]);
    expect(state.created, 'no new token may be minted on reuse').toHaveLength(0);
  });

  it('treats a revoked token as reuse too', async () => {
    seedToken({ revoked_at: new Date(Date.now() - 60_000) });
    await expect(rotateRefreshToken('raw', {})).rejects.toThrow();
    expect(state.familyRevocations[0]?.reason).toBe('REUSE_DETECTED');
  });

  it('tags the error so the caller can audit it', async () => {
    seedToken({ used_at: new Date() });
    await rotateRefreshToken('raw', {}).then(
      () => expect.fail('should have thrown'),
      (err: Record<string, unknown>) => {
        expect(err.reuseDetected).toBe(true);
        expect(err.firmId).toBe(FIRM);
        expect(err.userId).toBe(USER);
      },
    );
  });

  /**
   * REGRESSION — this shipped broken.
   *
   * The original code read used_at, found it null, and only then wrote. Two
   * requests presenting the same token both passed the read and both minted a
   * new one, so a thief replaying a stolen token alongside the real user was
   * the exact case reuse detection silently failed to catch. Against a live
   * database four concurrent refreshes all returned 200.
   *
   * The fix makes the database the arbiter: a conditional update that exactly
   * one caller can win. Anyone who updates zero rows has lost the race and is
   * treated as reuse.
   */
  it('lets exactly one of several concurrent rotations win', async () => {
    seedToken();

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => rotateRefreshToken('raw', {})),
    );

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');

    expect(won, 'exactly one concurrent rotation may succeed').toHaveLength(1);
    expect(lost).toHaveLength(3);
    expect(state.created, 'only the winner may mint a token').toHaveLength(1);
    expect(
      state.familyRevocations.length,
      'the losers must be reported as reuse',
    ).toBeGreaterThan(0);
    expect(state.familyRevocations.every((r) => r.reason === 'REUSE_DETECTED')).toBe(true);
  });

  it('does not mint a token when the claim touches no row', async () => {
    seedToken();
    // Simulate another request having spent the row between the read and the
    // claim — the window the conditional update exists to close.
    state.usedAt = new Date();

    await expect(rotateRefreshToken('raw', {})).rejects.toThrow();
    expect(state.created).toHaveLength(0);
  });
});

describe('revokeFamily', () => {
  it('revokes through withTenant with a stated reason', async () => {
    await revokeFamily(FIRM, FAMILY, 'PASSWORD_CHANGED');
    expect(withTenant).toHaveBeenCalledWith(FIRM, expect.any(Function));
    expect(state.familyRevocations).toEqual([
      { familyId: FAMILY, reason: 'PASSWORD_CHANGED' },
    ]);
  });
});
