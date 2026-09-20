import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Crypto tests (F-05).
 *
 * The firm key lookup touches the database, so it is stubbed here: these tests
 * are about the cipher contract, not about Prisma. What matters is that a
 * ciphertext is bound to exactly one (firm, table, column, row) and refuses to
 * decrypt anywhere else.
 */

const FIRM_A = '01a00000-0000-7000-8000-00000000000a';
const FIRM_B = '01a00000-0000-7000-8000-00000000000b';

const KEY_A = Buffer.alloc(32, 1);
const KEY_B = Buffer.alloc(32, 2);

// getFirmDek resolves the key through withTenant, so stubbing that is enough
// to exercise the cipher without a database. Spying on the exported function
// would not work: encryptField calls the module-local binding.
vi.mock('../../db/tenant', () => ({
  withTenant: vi.fn(async (firmId: string) => (firmId === FIRM_A ? KEY_A : KEY_B)),
}));

vi.mock('../../config/env', () => ({
  env: {
    KMS_LOCAL_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    BLIND_INDEX_PEPPER: 'test-pepper-at-least-16-chars-long',
  },
  isProd: false,
  isTest: true,
}));

let crypto: typeof import('./index');

beforeAll(async () => {
  crypto = await import('./index');
});

const ctxA = {
  firmId: FIRM_A,
  table: 'client',
  column: 'pan_enc',
  rowId: '01a00000-0000-7000-8000-000000000001',
};

describe('field encryption', () => {
  it('round-trips a value', async () => {
    const enc = await crypto.encryptField('ABCDE1234F', ctxA);
    expect(Buffer.from(enc).toString('utf8')).not.toContain('ABCDE1234F');
    await expect(crypto.decryptField(enc, ctxA)).resolves.toBe('ABCDE1234F');
  });

  it('produces different ciphertext each time (random IV)', async () => {
    const a = await crypto.encryptField('ABCDE1234F', ctxA);
    const b = await crypto.encryptField('ABCDE1234F', ctxA);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('refuses a ciphertext moved to another ROW', async () => {
    const enc = await crypto.encryptField('ABCDE1234F', ctxA);
    await expect(
      crypto.decryptField(enc, { ...ctxA, rowId: '01a00000-0000-7000-8000-000000000002' }),
    ).rejects.toThrow();
  });

  it('refuses a ciphertext moved to another COLUMN', async () => {
    const enc = await crypto.encryptField('ABCDE1234F', ctxA);
    await expect(crypto.decryptField(enc, { ...ctxA, column: 'gstin_enc' })).rejects.toThrow();
  });

  it('refuses a ciphertext moved to another TENANT', async () => {
    // The single most important property: copying a row into another firm's
    // table does not hand that firm a readable PAN.
    const enc = await crypto.encryptField('ABCDE1234F', ctxA);
    await expect(crypto.decryptField(enc, { ...ctxA, firmId: FIRM_B })).rejects.toThrow();
  });

  it('refuses tampered ciphertext', async () => {
    const enc = Buffer.from(await crypto.encryptField('ABCDE1234F', ctxA));
    enc[enc.length - 1] = (enc[enc.length - 1]! ^ 0xff) & 0xff;
    await expect(crypto.decryptField(enc, ctxA)).rejects.toThrow();
  });

  it('passes null through', async () => {
    await expect(crypto.decryptField(null, ctxA)).resolves.toBeNull();
  });
});

describe('blind index', () => {
  it('is deterministic for the same value, field and firm', () => {
    const a = crypto.blindIndex('ABCDE1234F', FIRM_A, 'client.pan');
    const b = crypto.blindIndex('ABCDE1234F', FIRM_A, 'client.pan');
    expect(a.equals(b)).toBe(true);
  });

  it('normalises case and whitespace, so a typo in spacing still matches', () => {
    const a = crypto.blindIndex('abcde1234f', FIRM_A, 'client.pan');
    const b = crypto.blindIndex('  ABCDE1234F ', FIRM_A, 'client.pan');
    expect(a.equals(b)).toBe(true);
  });

  it('differs across firms, so one firm cannot probe another for a PAN', () => {
    const a = crypto.blindIndex('ABCDE1234F', FIRM_A, 'client.pan');
    const b = crypto.blindIndex('ABCDE1234F', FIRM_B, 'client.pan');
    expect(a.equals(b)).toBe(false);
  });

  it('differs across fields', () => {
    const a = crypto.blindIndex('ABCDE1234F', FIRM_A, 'client.pan');
    const b = crypto.blindIndex('ABCDE1234F', FIRM_A, 'promoter.pan');
    expect(a.equals(b)).toBe(false);
  });

  it('is not reversible to the plaintext', () => {
    const idx = crypto.blindIndex('ABCDE1234F', FIRM_A, 'client.pan');
    expect(idx.toString('utf8')).not.toContain('ABCDE1234F');
    expect(idx.length).toBe(32);
  });
});

describe('masking', () => {
  it('shows only the last four characters', () => {
    expect(crypto.maskedFromLast4('234F')).toBe('••••••234F');
    expect(crypto.maskedFromLast4(null)).toBeNull();
  });

  it('never returns the full value', () => {
    const masked = crypto.maskedFromLast4('234F');
    expect(masked).not.toContain('ABCDE');
  });
});
