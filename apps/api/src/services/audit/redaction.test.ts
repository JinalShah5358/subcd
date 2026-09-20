import { describe, expect, it } from 'vitest';
import { changedFieldNames } from './auditWriter';
import { SENSITIVE_PATTERNS } from '../../utils/logger';

/**
 * Canary test (F-04).
 *
 * Feeds fake-but-realistic identifiers through the audit helpers and asserts
 * none of them can survive into an audit row. The audit trail must record THAT
 * a value was seen or changed — never the value.
 */

const CANARIES = {
  pan: 'ZZZPZ9999Z',
  aadhaar: '234567890123',
  account: '918273645500',
  gstin: '24ZZZPZ9999Z1Z5',
};

function containsCanary(serialised: string): string | null {
  for (const [name, value] of Object.entries(CANARIES)) {
    if (serialised.includes(value)) return name;
  }
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(serialised)) return `pattern ${pattern}`;
  }
  return null;
}

describe('audit redaction canaries', () => {
  it('changedFieldNames returns names, never values', () => {
    const before = { pan: 'AAAPA1111A', legalName: 'Old Name', notes: null };
    const after = { pan: CANARIES.pan, legalName: 'Old Name', notes: CANARIES.aadhaar };

    const names = changedFieldNames(before, after);

    expect(names).toContain('pan');
    expect(names).toContain('notes');
    // Unchanged fields are not listed at all.
    expect(names).not.toContain('legalName');

    const leak = containsCanary(JSON.stringify(names));
    expect(leak, `changedFieldNames leaked ${leak}`).toBeNull();
  });

  it('changedFieldNames on a create lists every supplied key without values', () => {
    const names = changedFieldNames(null, { pan: CANARIES.pan, gstin: CANARIES.gstin });
    expect(names.sort()).toEqual(['gstin', 'pan']);
    expect(containsCanary(JSON.stringify(names))).toBeNull();
  });

  it('compares dates by value but still reports only the name', () => {
    const names = changedFieldNames(
      { firstDisbursementDate: new Date('2025-01-01') },
      { firstDisbursementDate: new Date('2025-06-01') },
    );
    expect(names).toEqual(['firstDisbursementDate']);
  });

  it('ignores undefined values so a partial update does not report phantom changes', () => {
    const names = changedFieldNames({ a: '1', b: '2' }, { a: '1', b: undefined });
    expect(names).toEqual([]);
  });

  it('the canary detector itself works', () => {
    // A test that cannot fail proves nothing — confirm it catches a real leak.
    expect(containsCanary(JSON.stringify({ value: CANARIES.pan }))).not.toBeNull();
    expect(containsCanary(JSON.stringify({ value: CANARIES.aadhaar }))).not.toBeNull();
  });
});
