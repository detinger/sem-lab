import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AnalysisConfiguration, SemModel } from '@sem-studio/contracts';
import { describe, expect, it } from 'vitest';
import {
  addConstruct,
  addIndicators,
  connect,
  updateConstruct,
  updateIndicator,
} from '../model-ops';
import { type DataSummary, cbDegreesOfFreedom, hasBlockingIssues, validate } from './validate';

const fixtures = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'fixtures', 'synthetic');
const load = (name: string): SemModel =>
  SemModel.parse(JSON.parse(readFileSync(join(fixtures, name, 'model.json'), 'utf8')));
const manifest = (name: string): { expectedTruths: string[] } =>
  JSON.parse(readFileSync(join(fixtures, name, 'manifest.json'), 'utf8')) as {
    expectedTruths: string[];
  };
const codes = (issues: ReturnType<typeof validate>): string[] => issues.map((i) => i.code);

/** A data summary in which every model column exists, is numeric and well-behaved. */
function cleanData(model: SemModel, rows = 500): DataSummary {
  return {
    rowCount: rows,
    completeRows: rows,
    columns: model.indicators.map((i) => ({
      name: i.column!,
      kind: 'numeric' as const,
      n: rows,
      nMissing: 0,
      sdSample: 1,
      min: 1,
      max: 7,
      skewness: 0,
      kurtosis: 0,
    })),
  };
}

const pls: AnalysisConfiguration = {
  method: 'pls-sem',
  engine: 'r-csem',
  estimator: 'pls-pm',
  missingData: 'listwise',
  seed: 1,
  bootstrap: {
    enabled: true,
    repetitions: 5000,
    ci: 'percentile',
    confidenceLevel: 0.95,
    sides: 'two-sided',
  },
  pls: { innerWeighting: 'path', maxIterations: 300, tolerance: 1e-7 },
};
const cb: AnalysisConfiguration = {
  method: 'cb-sem',
  engine: 'r-lavaan',
  estimator: 'ML',
  missingData: 'listwise',
  cb: { identification: 'marker', meanStructure: false },
};

describe('CB degrees of freedom (necessary identification condition)', () => {
  it.each([
    ['tam-mediation-exact', 41],
    ['cfa-two-factor-exact', 19],
    ['cfa-one-factor', 5],
    ['cb-heywood-exact', 0],
  ])('%s has df = %i, matching the fixture truth', (name, df) => {
    expect(cbDegreesOfFreedom(load(name))?.df).toBe(df);
    // the fixture manifests state these values independently (fixture agent's own count)
    if (name !== 'cfa-one-factor')
      expect(manifest(name).expectedTruths.join(' ')).toMatch(new RegExp(`df\\s*=\\s*${df}\\b`));
  });
  it('counts the disturbance covariance lavaan frees between two outcomes of one factor', () => {
    // A → B, A → C with three indicators each. lavaan 0.7-3 sem(): npar = 21, df = 24, B ~~ C
    // free (auto.cov.y). The validator's former independent count missed B ~~ C (df 25).
    let m = SemModel.parse({ constructs: [], indicators: [], relationships: [] });
    for (const name of ['A', 'B', 'C']) {
      const r = addConstruct(m, { name });
      m = addIndicators(
        r.model,
        r.id,
        [1, 2, 3].map((k) => ({ name: `${name.toLowerCase()}${k}` })),
      ).model;
    }
    const id = (n: string) => m.constructs.find((c) => c.name === n)!.id;
    m = connect(m, id('A'), id('B')).model;
    m = connect(m, id('A'), id('C')).model;
    expect(cbDegreesOfFreedom(m)).toEqual({ moments: 45, parameters: 21, df: 24 });
  });
  it('flags a negative-df model as not identified and a df = 0 model as just-identified', () => {
    const heywood = load('cb-heywood-exact');
    expect(codes(validate({ model: heywood, method: 'cb-sem' }))).toContain('CB_JUST_IDENTIFIED');
    // one factor, two indicators, nothing else: df = 3 − 4 = −1
    let m = addConstruct(SemModel.parse({ constructs: [], indicators: [], relationships: [] }), {
      name: 'F',
    }).model;
    m = addIndicators(m, 'c_f', [{ name: 'a' }, { name: 'b' }]).model;
    const issues = validate({ model: m, method: 'cb-sem' });
    expect(codes(issues)).toEqual(
      expect.arrayContaining(['CB_NOT_IDENTIFIED_T_RULE', 'CB_TWO_INDICATOR_FACTOR_ALONE']),
    );
  });
});

describe('every runnable synthetic fixture is valid for the analyses it declares', () => {
  for (const name of [
    'pls-two-construct',
    'pls-mixed-composite',
    'tam-mediation',
    'poor-discriminant',
    'tam-mediation-exact',
    'cfa-two-factor',
    'cfa-one-factor',
  ]) {
    it(name, () => {
      const model = load(name);
      const analyses = JSON.parse(
        readFileSync(join(fixtures, name, 'analyses.json'), 'utf8'),
      ) as Array<{ id: string; analysis: AnalysisConfiguration }>;
      for (const { id, analysis } of analyses) {
        const issues = validate({
          model,
          analysis: { ...analysis, ipma: undefined },
          data: cleanData(model),
        });
        const errors = issues.filter((i) => i.severity === 'error');
        // Capability gates may legitimately block planned features (e.g. BCa); everything else must pass.
        expect(
          errors
            .filter((e) => e.code !== 'CAPABILITY_UNAVAILABLE')
            .map((e) => `${id}: ${e.code} ${e.title}`),
        ).toEqual([]);
      }
    });
  }
});

describe('the broken-mapping fixture is refused and names exactly the missing columns', () => {
  it('reports DATA_COLUMN_MISSING for pu5 and bi_4', () => {
    const model = load('broken-mapping');
    const data = cleanData(load('tam-mediation'));
    const issue = validate({ model, analysis: pls, data }).find(
      (i) => i.code === 'DATA_COLUMN_MISSING',
    );
    expect(issue?.columns?.sort()).toEqual(['bi_4', 'pu5']);
    expect(hasBlockingIssues(validate({ model, analysis: pls, data }))).toBe(true);
  });
});

describe('method semantics', () => {
  const tam = load('tam-mediation');
  it('rejects composite blocks in CB-SEM instead of converting them', () => {
    const m = updateConstruct(tam, 'c_pu', { measurement: 'composite-formative' });
    expect(codes(validate({ model: m, analysis: cb }))).toContain('CB_COMPOSITE_UNSUPPORTED');
    expect(codes(validate({ model: m, analysis: pls }))).not.toContain('CB_COMPOSITE_UNSUPPORTED');
  });
  it('requires a structural model for PLS but accepts a CFA for CB-SEM', () => {
    const cfa = load('cfa-two-factor');
    expect(codes(validate({ model: cfa, method: 'pls-sem' }))).toContain('PLS_NO_STRUCTURAL_MODEL');
    expect(
      validate({ model: cfa, method: 'cb-sem' }).filter((i) => i.severity === 'error'),
    ).toEqual([]);
  });
  it('blocks feedback loops that arrive outside the modeler (e.g. an imported file)', () => {
    // connect() already refuses this reciprocal path; an imported project can still contain one.
    const base = load('tam-mediation');
    expect(() => connect(base, 'c_bi', 'c_peou')).toThrow(/opposite path/);
    const cyclic = {
      ...base,
      relationships: [
        ...base.relationships,
        { id: 'r_loop', kind: 'structural' as const, sourceId: 'c_bi', targetId: 'c_peou' },
      ],
    };
    expect(codes(validate({ model: cyclic, method: 'pls-sem' }))).toContain('STRUCTURAL_CYCLE');
  });
  it('notes that PLS ignores covariances', () => {
    expect(codes(validate({ model: load('pls-mixed-composite'), method: 'pls-sem' }))).toContain(
      'PLS_IGNORES_COVARIANCES',
    );
  });
  it('refuses IPMA on PLSc and without scale endpoints', () => {
    const noScale = { ...tam, indicators: tam.indicators.map((i) => ({ ...i, scale: undefined })) };
    const plsc: AnalysisConfiguration = {
      ...pls,
      method: 'plsc',
      ipma: { targetConstructId: 'c_bi' },
    };
    const c = codes(validate({ model: noScale, analysis: plsc, data: cleanData(noScale) }));
    expect(c).toEqual(expect.arrayContaining(['IPMA_ON_PLSC', 'IPMA_SCALE_MISSING']));
  });
});

describe('data checks', () => {
  const tam = load('tam-mediation');
  it('refuses text, constant and out-of-scale columns', () => {
    const data = cleanData(tam);
    const cols = data.columns.map((c) =>
      c.name === 'pu1'
        ? { ...c, kind: 'text' as const, nonNumericCount: 4 }
        : c.name === 'pu2'
          ? { ...c, sdSample: 0 }
          : c.name === 'pu3'
            ? { ...c, max: 99 }
            : c,
    );
    const c = codes(validate({ model: tam, analysis: pls, data: { ...data, columns: cols } }));
    expect(c).toEqual(
      expect.arrayContaining(['DATA_NOT_NUMERIC', 'DATA_ZERO_VARIANCE', 'DATA_OUTSIDE_SCALE']),
    );
  });
  it('flags two indicators bound to one column and reverse scoring without endpoints', () => {
    let m = updateIndicator(tam, 'i_pu2', { column: 'pu1' });
    m = updateIndicator(m, 'i_pu3', { scale: undefined, reverseScored: true });
    const c = codes(validate({ model: m, analysis: pls, data: cleanData(tam) }));
    expect(c).toEqual(expect.arrayContaining(['DATA_COLUMN_REUSED', 'REVERSE_WITHOUT_SCALE']));
  });
  it('reports listwise deletion with counts, and FIML as information', () => {
    const data = { ...cleanData(load('cfa-two-factor'), 500), completeRows: 258 };
    data.columns = data.columns.map((c) => ({ ...c, nMissing: 40 }));
    const listwise = validate({ model: load('cfa-two-factor'), analysis: cb, data }).find(
      (i) => i.code === 'DATA_MISSING_VALUES',
    )!;
    expect(listwise.severity).toBe('warning');
    expect(listwise.title).toMatch(/removes 242 of 500 rows \(48\.4%\)/);
    const fiml = validate({
      model: load('cfa-two-factor'),
      analysis: { ...cb, missingData: 'fiml' },
      data,
    }).find((i) => i.code === 'DATA_MISSING_VALUES')!;
    expect(fiml.severity).toBe('info');
  });
  it('enforces mathematical sample-size floors and never uses the 10-times rule', () => {
    const issues = validate({ model: tam, analysis: pls, data: cleanData(tam, 3) });
    expect(codes(issues)).toContain('DATA_N_BELOW_PREDICTORS');
    const ok = validate({ model: tam, analysis: pls, data: cleanData(tam, 500) });
    const s = ok.find((i) => i.code === 'SAMPLE_SIZE_JUSTIFICATION')!;
    expect(s.severity).toBe('recommendation');
    expect(s.explanation).toMatch(/not a defensible/);
  });
});

describe('estimator gates come from the capability registry', () => {
  const tam = load('tam-mediation');
  it('blocks capabilities the registry marks unsupported or planned', () => {
    expect(
      codes(
        validate({
          model: tam,
          analysis: {
            ...pls,
            engine: 'r-seminr',
            pls: { ...pls.pls!, innerWeighting: 'centroid' },
          },
        }),
      ),
    ).toContain('CAPABILITY_UNAVAILABLE');
    expect(
      codes(
        validate({ model: tam, analysis: { ...pls, bootstrap: { ...pls.bootstrap!, ci: 'bca' } } }),
      ),
    ).toContain('CAPABILITY_UNAVAILABLE');
    expect(codes(validate({ model: tam, analysis: { ...pls, engine: 'py-plspm' } }))).toContain(
      'CAPABILITY_UNAVAILABLE',
    ); // plspm bootstrap is unsupported
    expect(
      validate({ model: tam, analysis: pls }).filter(
        (i) => i.layer === 'estimator' && i.severity === 'error',
      ),
    ).toEqual([]);
  });
  it('sorts errors first', () => {
    const issues = validate({
      model: load('broken-mapping'),
      analysis: { ...pls, bootstrap: { ...pls.bootstrap!, repetitions: 200 } },
      data: cleanData(tam),
    });
    const order = issues.map((i) =>
      ['error', 'warning', 'recommendation', 'info'].indexOf(i.severity),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
