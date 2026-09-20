import { describe, expect, it } from 'vitest';
import { evaluate, validateExpression, RuleEvaluationError, type EvalContext } from './operators';

const ctx = (values: Record<string, unknown>, params: Record<string, unknown> = {}): EvalContext => ({
  values,
  params,
  today: '2026-06-15',
});

describe('rule operators', () => {
  it('rejects an unknown operator instead of silently passing', () => {
    expect(() => evaluate({ op: 'rm -rf' }, ctx({}))).toThrow(RuleEvaluationError);
    expect(() => validateExpression({ op: 'exec' })).toThrow(RuleEvaluationError);
  });

  it('has no code-execution path: expressions are data only', () => {
    // A rule row is operator + operands. There is no place to put code.
    expect(() => evaluate({ op: 'eval', code: '1+1' }, ctx({}))).toThrow(RuleEvaluationError);
  });

  describe('presence', () => {
    it('treats empty strings as absent', () => {
      expect(evaluate({ op: 'isPresent', field: 'a' }, ctx({ a: '' }))).toBe(false);
      expect(evaluate({ op: 'isBlank', field: 'a' }, ctx({ a: '   ' }))).toBe(true);
      expect(evaluate({ op: 'isPresent', field: 'a' }, ctx({ a: 'x' }))).toBe(true);
    });

    it('treats a missing key as absent', () => {
      expect(evaluate({ op: 'isPresent', field: 'nope' }, ctx({}))).toBe(false);
    });
  });

  describe('matchesRegex', () => {
    it('validates a PAN', () => {
      const node = { op: 'matchesRegex', field: 'pan', pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$' };
      expect(evaluate(node, ctx({ pan: 'ABCDE1234F' }))).toBe(true);
      expect(evaluate(node, ctx({ pan: 'ABCD1234F' }))).toBe(false);
    });

    it('caps pattern length so a rule cannot be a self-inflicted DoS', () => {
      const node = { op: 'matchesRegex', field: 'a', pattern: 'x'.repeat(300) };
      expect(() => evaluate(node, ctx({ a: 'x' }))).toThrow(RuleEvaluationError);
    });
  });

  describe('comparisons pass when data is missing', () => {
    // Absence is a REQUIRED rule's job. A comparison rule must not also fire,
    // or a half-entered draft produces a wall of spurious findings.
    it('lteField passes when either side is absent', () => {
      expect(evaluate({ op: 'lteField', field: 'a', otherField: 'b' }, ctx({ a: null, b: 5 }))).toBe(true);
      expect(evaluate({ op: 'lteField', field: 'a', otherField: 'b' }, ctx({ a: 5, b: null }))).toBe(true);
    });

    it('lteField compares when both are present', () => {
      expect(evaluate({ op: 'lteField', field: 'a', otherField: 'b' }, ctx({ a: '5', b: '4' }))).toBe(false);
      expect(evaluate({ op: 'lteField', field: 'a', otherField: 'b' }, ctx({ a: '4', b: '4' }))).toBe(true);
    });
  });

  describe('dates', () => {
    it('orders dates, tolerating absence', () => {
      const node = { op: 'dateOrder', earlier: 'a', later: 'b', orEqual: true };
      expect(evaluate(node, ctx({ a: '2026-01-01', b: '2026-02-01' }))).toBe(true);
      expect(evaluate(node, ctx({ a: '2026-03-01', b: '2026-02-01' }))).toBe(false);
      expect(evaluate(node, ctx({ a: '2026-02-01', b: '2026-02-01' }))).toBe(true);
      expect(evaluate(node, ctx({ a: null, b: '2026-02-01' }))).toBe(true);
    });

    it('rejects future dates against the injected clock, not the wall clock', () => {
      const node = { op: 'noneInFuture', fields: ['a', 'b'] };
      expect(evaluate(node, ctx({ a: '2026-06-14', b: '2026-01-01' }))).toBe(true);
      expect(evaluate(node, ctx({ a: '2026-06-16', b: null }))).toBe(false);
    });

    it('measures a window in whole months, taking the day of month into account', () => {
      const node = {
        op: 'dateWithinMonths',
        field: 'app',
        fromField: 'disb',
        maxMonths: { param: 'windowMonths' },
      };
      const params = { windowMonths: 12 };
      expect(evaluate(node, ctx({ app: '2026-06-01', disb: '2025-07-01' }, params))).toBe(true);
      expect(evaluate(node, ctx({ app: '2026-07-01', disb: '2025-07-01' }, params))).toBe(true);
      expect(evaluate(node, ctx({ app: '2026-07-02', disb: '2025-07-01' }, params))).toBe(false);
      // Application before disbursement is out of the window, not merely early.
      expect(evaluate(node, ctx({ app: '2025-06-01', disb: '2025-07-01' }, params))).toBe(false);
    });

    it('refuses to run a window rule with no threshold configured', () => {
      const node = { op: 'dateWithinMonths', field: 'a', fromField: 'b', maxMonths: { param: 'missing' } };
      expect(() => evaluate(node, ctx({ a: '2026-01-01', b: '2025-01-01' }))).toThrow(RuleEvaluationError);
    });
  });

  describe('sumEquals', () => {
    const node = {
      op: 'sumEquals',
      fields: ['a', 'b', 'c'],
      totalField: 'total',
      tolerance: { param: 'tolerance' },
    };
    const params = { tolerance: 1 };

    it('passes within tolerance', () => {
      expect(evaluate(node, ctx({ a: '100', b: '200', c: '700', total: '1000' }, params))).toBe(true);
      expect(evaluate(node, ctx({ a: '100', b: '200', c: '700.5', total: '1000' }, params))).toBe(true);
    });

    it('fails outside tolerance', () => {
      expect(evaluate(node, ctx({ a: '100', b: '200', c: '650', total: '1000' }, params))).toBe(false);
    });

    it('passes when nothing has been entered yet', () => {
      expect(evaluate(node, ctx({ a: null, b: null, c: null, total: '1000' }, params))).toBe(true);
    });

    it('passes when the total is absent', () => {
      expect(evaluate(node, ctx({ a: '100', b: null, c: null, total: null }, params))).toBe(true);
    });
  });

  describe('ratioAtLeast', () => {
    const node = {
      op: 'ratioAtLeast',
      numerator: 'n',
      denominator: 'd',
      min: { param: 'minRatio' },
    };

    it('compares the ratio', () => {
      expect(evaluate(node, ctx({ n: 38, d: 40 }, { minRatio: 0.8 }))).toBe(true);
      expect(evaluate(node, ctx({ n: 20, d: 40 }, { minRatio: 0.8 }))).toBe(false);
    });

    it('does not divide by zero', () => {
      expect(evaluate(node, ctx({ n: 0, d: 0 }, { minRatio: 0.8 }))).toBe(true);
    });
  });

  describe('boolean composition', () => {
    it('ands and ors', () => {
      const values = { a: 'x', b: '' };
      expect(
        evaluate(
          { op: 'and', args: [{ op: 'isPresent', field: 'a' }, { op: 'isBlank', field: 'b' }] },
          ctx(values),
        ),
      ).toBe(true);
      expect(
        evaluate(
          { op: 'or', args: [{ op: 'isPresent', field: 'b' }, { op: 'isBlank', field: 'b' }] },
          ctx(values),
        ),
      ).toBe(true);
      expect(evaluate({ op: 'not', arg: { op: 'isPresent', field: 'a' } }, ctx(values))).toBe(false);
    });

    it('rejects deeply nested expressions at publish time', () => {
      let node: Record<string, unknown> = { op: 'isPresent', field: 'a' };
      for (let i = 0; i < 15; i++) node = { op: 'and', args: [node] };
      expect(() => validateExpression(node)).toThrow(RuleEvaluationError);
    });
  });

  it('is a pure function of its inputs', () => {
    const node = { op: 'isPresent', field: 'a' };
    const c = ctx({ a: 'x' });
    expect(evaluate(node, c)).toBe(evaluate(node, c));
  });
});
