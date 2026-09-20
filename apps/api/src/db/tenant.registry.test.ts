import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { HYBRID_MODELS, SELF_MODELS, TENANT_MODELS } from './tenant';

/**
 * F-01, layer 1: the schema and the tenant registry must agree.
 *
 * This is the test that would have caught the firm-settings bug. `Firm` was in
 * none of the three sets, so the client extension skipped the model entirely —
 * no tenant predicate, no transaction, `app.firm_id` never set, and every RLS
 * policy correctly refusing a client that would not say who it was. The result
 * was a 404 on a firm that plainly exists.
 *
 * The failure mode is silent by construction: forgetting to classify a model
 * does not raise anything, it just quietly removes a layer of isolation. So
 * the registry is checked against the schema mechanically, and every model is
 * required to be classified — including the ones that are deliberately global.
 * Adding a model to the schema and not thinking about tenancy is now a test
 * failure rather than a discovery in production.
 */

const SCHEMA = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'prisma', 'schema.prisma'),
  'utf8',
);

interface ParsedModel {
  name: string;
  /** 'required' | 'optional' | null — the shape of the model's firmId field. */
  firmId: 'required' | 'optional' | null;
}

function parseModels(schema: string): ParsedModel[] {
  const out: ParsedModel[] = [];
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;

  while ((m = modelRe.exec(schema)) !== null) {
    const [, name, body] = m;
    // Match the scalar field only, never the `firm Firm @relation(...)` line.
    const field = /^\s*firmId\s+String(\?)?/m.exec(body!);
    out.push({
      name: name!,
      firmId: field ? (field[1] ? 'optional' : 'required') : null,
    });
  }
  return out;
}

const MODELS = parseModels(SCHEMA);

/**
 * Models that legitimately carry no tenant column: platform catalogs every
 * firm reads and no firm owns. This list is deliberately explicit — a new
 * model lands here by someone's decision, not by omission.
 */
const GLOBAL_MODELS = new Set<string>([
  'District',
  'Taluka',
  'Scheme',
  'SchemeVersion',
  'SchemeDocumentRequirement',
  'ValidationRule',
  'ValidationRuleVersion',
  'ConsentTemplate',
  // The identity of a form on the portal. Same for every firm.
  'FormDefinition',
]);

describe('tenant model registry', () => {
  it('parses the schema it is asserting against', () => {
    // A regex that silently matched nothing would make every test below pass.
    expect(MODELS.length).toBeGreaterThan(20);
    expect(MODELS.map((x) => x.name)).toContain('Client');
    expect(MODELS.find((x) => x.name === 'Client')?.firmId).toBe('required');
    expect(MODELS.find((x) => x.name === 'Bank')?.firmId).toBe('optional');
    expect(MODELS.find((x) => x.name === 'Firm')?.firmId).toBeNull();
  });

  it('classifies every model in the schema exactly once', () => {
    const unclassified: string[] = [];
    const duplicated: string[] = [];

    for (const model of MODELS) {
      const sets = [
        TENANT_MODELS.has(model.name),
        HYBRID_MODELS.has(model.name),
        SELF_MODELS.has(model.name),
        GLOBAL_MODELS.has(model.name),
      ].filter(Boolean).length;

      if (sets === 0) unclassified.push(model.name);
      if (sets > 1) duplicated.push(model.name);
    }

    expect(
      unclassified,
      `Unclassified model(s). Add each to TENANT_MODELS, HYBRID_MODELS, SELF_MODELS, ` +
        `or GLOBAL_MODELS in this test — and be sure which one it is.`,
    ).toEqual([]);
    expect(duplicated, 'Model(s) in more than one tenancy set').toEqual([]);
  });

  it('puts every model with a required firmId in TENANT_MODELS', () => {
    const required = MODELS.filter((x) => x.firmId === 'required').map((x) => x.name);
    const missing = required.filter((name) => !TENANT_MODELS.has(name));

    expect(required.length).toBeGreaterThan(10);
    expect(
      missing,
      'Model(s) with a required firm_id that the extension would not scope',
    ).toEqual([]);
  });

  it('puts every model with an optional firmId in HYBRID_MODELS', () => {
    const optional = MODELS.filter((x) => x.firmId === 'optional').map((x) => x.name);
    expect([...HYBRID_MODELS].sort()).toEqual(optional.sort());
  });

  it('holds no model that the schema does not define', () => {
    const known = new Set(MODELS.map((x) => x.name));
    const phantom = [...TENANT_MODELS, ...HYBRID_MODELS, ...SELF_MODELS].filter(
      (name) => !known.has(name),
    );
    // A renamed model leaves a stale entry behind, and a stale entry scopes
    // nothing at all.
    expect(phantom, 'Registry entr(ies) with no matching model in schema.prisma').toEqual([]);
  });

  it('scopes no global catalog, and treats only the firm row as self-scoped', () => {
    for (const name of GLOBAL_MODELS) {
      expect(TENANT_MODELS.has(name), `${name} is a catalog, not tenant-owned`).toBe(false);
      expect(HYBRID_MODELS.has(name), `${name} is a catalog, not hybrid`).toBe(false);
    }
    expect([...SELF_MODELS]).toEqual(['Firm']);
    expect(MODELS.find((x) => x.name === 'Firm')?.firmId).toBeNull();
  });
});
