/**
 * The rule expression evaluator.
 *
 * This is a CLOSED operator table. There is no eval(), no Function
 * constructor, and no way for rule data in the database to execute code.
 * Adding an operator is a code change with a test; changing a threshold is a
 * data change. That split is the entire point of ADR-005.
 *
 * An expression returns TRUE when the rule PASSES. A finding is raised on FALSE.
 */

export type ValueMap = Record<string, unknown>;
export type Params = Record<string, unknown>;

export interface EvalContext {
  values: ValueMap;
  params: Params;
  /** Injected so a run is a pure function of its inputs and stays reproducible. */
  today: string; // YYYY-MM-DD
}

export class RuleEvaluationError extends Error {}

type Node = Record<string, unknown>;

/* ------------------------------ helpers ------------------------------ */

function resolveParam(raw: unknown, ctx: EvalContext): unknown {
  if (raw && typeof raw === 'object' && 'param' in (raw as Node)) {
    const key = (raw as Node).param;
    if (typeof key !== 'string') throw new RuleEvaluationError('param reference must be a string');
    return ctx.params[key];
  }
  return raw;
}

function valueOf(field: unknown, ctx: EvalContext): unknown {
  if (typeof field !== 'string') throw new RuleEvaluationError('field must be a string');
  return ctx.values[field];
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function toNumber(v: unknown): number | null {
  if (isEmpty(v)) return null;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): string | null {
  if (isEmpty(v)) return null;
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Adds whole months to a date, clamping to the end of a shorter month
 * (31 Jan + 1 month = 28 Feb). Returns an ISO date string.
 *
 * Eligibility windows are compared against this exact anniversary date rather
 * than a count of whole months: "within 12 months of 1 July 2025" ends on
 * 1 July 2026, so 2 July 2026 is outside it — a whole-month count would round
 * that back to 12 and wrongly let it through.
 */
function addMonths(fromISO: string, months: number): string {
  const [y, m, d] = fromISO.split('-').map(Number) as [number, number, number];
  const targetMonthIndex = m - 1 + months;
  const year = y + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, daysInTargetMonth);
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/* ------------------------------ operators ---------------------------- */

type OperatorFn = (node: Node, ctx: EvalContext) => boolean;

const OPERATORS: Record<string, OperatorFn> = {
  and: (node, ctx) => asArray(node.args).every((a) => evaluate(a, ctx)),
  or: (node, ctx) => asArray(node.args).some((a) => evaluate(a, ctx)),
  not: (node, ctx) => !evaluate(node.arg as Node, ctx),

  isPresent: (node, ctx) => !isEmpty(valueOf(node.field, ctx)),
  isBlank: (node, ctx) => isEmpty(valueOf(node.field, ctx)),
  isTrue: (node, ctx) => valueOf(node.field, ctx) === true,
  isFalse: (node, ctx) => valueOf(node.field, ctx) === false,

  matchesRegex: (node, ctx) => {
    const v = valueOf(node.field, ctx);
    if (isEmpty(v)) return false;
    const pattern = node.pattern;
    if (typeof pattern !== 'string') throw new RuleEvaluationError('pattern must be a string');
    // Rule authors are platform admins, but a pathological pattern would still
    // be a self-inflicted DoS, so cap the source length.
    if (pattern.length > 200) throw new RuleEvaluationError('pattern too long');
    return new RegExp(pattern).test(String(v));
  },

  equalsValue: (node, ctx) => String(valueOf(node.field, ctx) ?? '') === String(resolveParam(node.value, ctx) ?? ''),

  equalsField: (node, ctx) =>
    String(valueOf(node.field, ctx) ?? '') === String(valueOf(node.otherField, ctx) ?? ''),

  /** Passes when either side is missing — absence is a REQUIRED rule's job. */
  lteField: (node, ctx) => {
    const a = toNumber(valueOf(node.field, ctx));
    const b = toNumber(valueOf(node.otherField, ctx));
    if (a === null || b === null) return true;
    return a <= b;
  },

  gteField: (node, ctx) => {
    const a = toNumber(valueOf(node.field, ctx));
    const b = toNumber(valueOf(node.otherField, ctx));
    if (a === null || b === null) return true;
    return a >= b;
  },

  numberBetween: (node, ctx) => {
    const v = toNumber(valueOf(node.field, ctx));
    if (v === null) return true;
    const min = toNumber(resolveParam(node.min, ctx));
    const max = toNumber(resolveParam(node.max, ctx));
    if (min !== null && v < min) return false;
    if (max !== null && v > max) return false;
    return true;
  },

  dateOrder: (node, ctx) => {
    const earlier = toDate(valueOf(node.earlier, ctx));
    const later = toDate(valueOf(node.later, ctx));
    if (!earlier || !later) return true;
    return node.orEqual === true ? earlier <= later : earlier < later;
  },

  noneInFuture: (node, ctx) => {
    const fields = asArray(node.fields);
    return fields.every((f) => {
      const d = toDate(valueOf(f, ctx));
      return d === null || d <= ctx.today;
    });
  },

  dateWithinMonths: (node, ctx) => {
    const target = toDate(valueOf(node.field, ctx));
    const from = toDate(valueOf(node.fromField, ctx));
    if (!target || !from) return true;
    const max = toNumber(resolveParam(node.maxMonths, ctx));
    if (max === null) throw new RuleEvaluationError('maxMonths is not configured');
    // Inside the window means: on or after the start, and on or before the
    // exact anniversary date.
    return target >= from && target <= addMonths(from, max);
  },

  sumEquals: (node, ctx) => {
    const total = toNumber(valueOf(node.totalField, ctx));
    if (total === null) return true;

    const parts = asArray(node.fields).map((f) => toNumber(valueOf(f, ctx)));
    // If nothing has been entered yet, there is nothing to reconcile.
    if (parts.every((p) => p === null)) return true;

    const sum = parts.reduce<number>((acc, p) => acc + (p ?? 0), 0);
    const tolerance = toNumber(resolveParam(node.tolerance, ctx)) ?? 1;
    return Math.abs(sum - total) <= tolerance;
  },

  ratioAtLeast: (node, ctx) => {
    const num = toNumber(valueOf(node.numerator, ctx));
    const den = toNumber(valueOf(node.denominator, ctx));
    if (num === null || den === null || den === 0) return true;
    const min = toNumber(resolveParam(node.min, ctx));
    if (min === null) throw new RuleEvaluationError('min ratio is not configured');
    return num / den >= min;
  },
};

function asArray(v: unknown): Node[] {
  if (!Array.isArray(v)) throw new RuleEvaluationError('expected an array argument');
  return v as Node[];
}

export const SUPPORTED_OPERATORS = Object.keys(OPERATORS);

export function evaluate(node: unknown, ctx: EvalContext): boolean {
  if (!node || typeof node !== 'object') {
    throw new RuleEvaluationError('expression node must be an object');
  }
  const op = (node as Node).op;
  if (typeof op !== 'string') throw new RuleEvaluationError('expression node needs an op');

  const fn = OPERATORS[op];
  if (!fn) throw new RuleEvaluationError(`unknown operator: ${op}`);

  return fn(node as Node, ctx);
}

/** Static check used when a rule version is published, so a bad rule fails early. */
export function validateExpression(node: unknown, depth = 0): void {
  if (depth > 12) throw new RuleEvaluationError('expression nested too deeply');
  if (!node || typeof node !== 'object') throw new RuleEvaluationError('invalid expression node');
  const op = (node as Node).op;
  if (typeof op !== 'string' || !OPERATORS[op]) {
    throw new RuleEvaluationError(`unknown operator: ${String(op)}`);
  }
  const args = (node as Node).args;
  if (Array.isArray(args)) args.forEach((a) => validateExpression(a, depth + 1));
  const single = (node as Node).arg;
  if (single) validateExpression(single, depth + 1);
}
