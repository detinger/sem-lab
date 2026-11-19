/**
 * Browser CB engine vs lavaan 0.7-3.
 *
 * Two oracles per case/variant:
 * - "committed": packages/fixtures/reference-results/cb/*.json (make_cb_references.R, lavaan
 *   defaults) plus its complete fitMeasures() vector in reference-results/cb-math/fit-measures.json
 *   (the committed files have an empty `fit`, see make_cb_math_references.R);
 * - "tight": the same lavaan model and options re-optimised to max |gradient| ≈ 1e-8
 *   (reference-results/cb-math/tight-refits.json). lavaan's default nlminb stopping rule
 *   (rel.tol 1e-10 on the objective) leaves parameter errors up to 1.8e-6 (service-quality),
 *   so the committed estimates cannot be matched to 1e-6 by an exact optimiser; the tight
 *   refit can, and is held to the full tolerances.
 */
import { readdirSync } from 'node:fs';
import { NormalizedSemResult } from '@sem-lab/contracts';
import { describe, expect, it } from 'vitest';
import { estimateCb } from '../../src/cb/index.ts';
import {
  type RefFile,
  type RefParam,
  analysisFor,
  findParam,
  fitValue,
  fixturePath,
  loadData,
  loadModel,
  readJson,
} from './helpers.ts';

type FitMap = Record<string, number | null>;
const files = readdirSync(fixturePath('reference-results/cb/'))
  .filter((f) => f.endsWith('.json'))
  .sort();
const fitRef = readJson<{ fits: Record<string, FitMap> }>(
  'reference-results/cb-math/fit-measures.json',
).fits;
const tightRef = readJson<{
  fits: Record<
    string,
    { parameters: Array<Omit<RefParam, 'z' | 'pvalue'>>; fit: FitMap; max_est_change: number }
  >;
}>('reference-results/cb-math/tight-refits.json').fits;

/** [our name, our variant, lavaan name] */
const FIT_MAP: Array<[string, 'standard' | 'scaled' | 'robust', string]> = [
  ['chisq', 'standard', 'chisq'],
  ['df', 'standard', 'df'],
  ['pvalue', 'standard', 'pvalue'],
  ['baseline.chisq', 'standard', 'baseline.chisq'],
  ['baseline.df', 'standard', 'baseline.df'],
  ['baseline.pvalue', 'standard', 'baseline.pvalue'],
  ['cfi', 'standard', 'cfi'],
  ['tli', 'standard', 'tli'],
  ['rmsea', 'standard', 'rmsea'],
  ['rmsea.pvalue', 'standard', 'rmsea.pvalue'],
  ['srmr', 'standard', 'srmr'],
  ['logl', 'standard', 'logl'],
  ['unrestricted.logl', 'standard', 'unrestricted.logl'],
  ['aic', 'standard', 'aic'],
  ['bic', 'standard', 'bic'],
  ['bic2', 'standard', 'bic2'],
  ['npar', 'standard', 'npar'],
  ['ntotal', 'standard', 'ntotal'],
  ['chisq', 'scaled', 'chisq.scaled'],
  ['chisq.scaling.factor', 'scaled', 'chisq.scaling.factor'],
  ['pvalue', 'scaled', 'pvalue.scaled'],
  ['baseline.chisq', 'scaled', 'baseline.chisq.scaled'],
  ['baseline.chisq.scaling.factor', 'scaled', 'baseline.chisq.scaling.factor'],
  ['cfi', 'scaled', 'cfi.scaled'],
  ['tli', 'scaled', 'tli.scaled'],
  ['rmsea', 'scaled', 'rmsea.scaled'],
  ['cfi', 'robust', 'cfi.robust'],
  ['tli', 'robust', 'tli.robust'],
  ['rmsea', 'robust', 'rmsea.robust'],
];
const CI_MAP: Array<['standard' | 'scaled' | 'robust', string, string]> = [
  ['standard', 'rmsea.ci.lower', 'rmsea.ci.upper'],
  ['scaled', 'rmsea.ci.lower.scaled', 'rmsea.ci.upper.scaled'],
  ['robust', 'rmsea.ci.lower.robust', 'rmsea.ci.upper.robust'],
];
/** Reported also for a just-identified model (everything else is deliberately null there). */
const DEFINED_AT_DF0 = new Set([
  'chisq',
  'df',
  'baseline.chisq',
  'baseline.df',
  'baseline.pvalue',
  'logl',
  'unrestricted.logl',
  'aic',
  'bic',
  'bic2',
  'npar',
  'ntotal',
]);
/** Values that are ~0 by construction in the exact fixtures (sub-1e-6) are compared absolutely. */
const ZERO_FLOOR = 1e-6;

interface Dev {
  est: number;
  se: number;
  std: number;
  p: number;
  fit: number;
  fitWorst: string;
  fitAbsZero: number;
  ci: number;
}

function paramDev(
  res: NormalizedSemResult,
  params: Array<Omit<RefParam, 'z' | 'pvalue'> & Partial<Pick<RefParam, 'z' | 'pvalue'>>>,
): Dev {
  const d: Dev = { est: 0, se: 0, std: 0, p: 0, fit: 0, fitWorst: '', fitAbsZero: 0, ci: 0 };
  for (const r of params) {
    const u = findParam(res, r as RefParam, 'unstandardized');
    const s = findParam(res, r as RefParam, 'standardized');
    expect(u, `${r.lhs} ${r.op} ${r.rhs}`).toBeDefined();
    expect(s, `${r.lhs} ${r.op} ${r.rhs} (std)`).toBeDefined();
    d.est = Math.max(d.est, Math.abs(u!.est! - r.est));
    if (u!.status === 'estimated') {
      expect(r.se).toBeGreaterThan(0);
      d.se = Math.max(d.se, Math.abs(u!.se! - r.se) / r.se);
      if (r.pvalue !== undefined && r.pvalue !== null)
        d.p = Math.max(d.p, Math.abs(u!.pValue! - r.pvalue));
    } else expect(r.se).toBe(0);
    if (r.std_all !== null) d.std = Math.max(d.std, Math.abs(s!.est! - r.std_all));
  }
  return d;
}

function fitDev(res: NormalizedSemResult, lav: FitMap, d: Dev): void {
  const justId = lav.df === 0;
  for (const [name, variant, lavName] of FIT_MAP) {
    const lv = lav[lavName];
    if (lv === undefined) continue; // lavaan does not report it for this estimator
    const ours = fitValue(res, name, variant);
    if (justId && !DEFINED_AT_DF0.has(name)) {
      if (ours) expect(ours.value, `${lavName} at df = 0`).toBeNull();
      continue;
    }
    if (lv === null) continue;
    // robust indices of an ML (non-MLR) fit are not produced; robust FIML indices are not supported
    if (!ours && variant !== 'standard' && !res.fit.some((f) => f.variant === 'scaled')) continue;
    if (ours?.missing === 'not-supported') continue;
    expect(ours, lavName).toBeDefined();
    expect(ours!.value, lavName).not.toBeNull();
    if (Math.abs(lv) < ZERO_FLOOR) {
      d.fitAbsZero = Math.max(d.fitAbsZero, Math.abs(ours!.value! - lv));
      continue;
    }
    const rel = Math.abs(ours!.value! - lv) / Math.abs(lv);
    if (rel > d.fit) {
      d.fit = rel;
      d.fitWorst = lavName;
    }
  }
  if (justId) return;
  for (const [variant, lo, hi] of CI_MAP) {
    if (lav[lo] === undefined || lav[lo] === null) continue;
    const ours = fitValue(res, 'rmsea', variant);
    if (!ours || ours.missing === 'not-supported') continue;
    d.ci = Math.max(d.ci, Math.abs(ours.ciLower! - lav[lo]), Math.abs(ours.ciUpper! - lav[hi]!));
  }
}

const fmt = (x: number): string => x.toExponential(1);

describe.each(files)('lavaan reference %s', (file) => {
  const ref = readJson<RefFile>(`reference-results/cb/${file}`);
  const variantKey = `${ref.case}__${ref.variant}`;

  it('matches estimates, SEs, std.all, fit measures and diagnostics', async () => {
    const t0 = performance.now();
    const out = await estimateCb({
      model: loadModel(ref.case),
      analysis: analysisFor(ref.variant),
      data: loadData(ref.case),
    });
    const ms = performance.now() - t0;
    if (!out.ok) throw new Error(`${out.error.code}: ${out.error.message}`);
    const res = out.result;
    const parsed = NormalizedSemResult.safeParse(res);
    expect(
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3)),
    ).toBe(true);

    expect(res.estimation.converged).toBe(ref.converged);
    expect(res.estimation.admissible).toBe(ref.post_check);
    expect(res.sample.nUsed).toBe(ref.n_used);
    expect(res.sample.nRows).toBe(ref.n_rows);
    if (!ref.post_check)
      expect(res.warnings.some((w) => w.code === 'CB_NEGATIVE_VARIANCE')).toBe(true);
    else
      expect(res.warnings.some((w) => w.severity === 'warning' || w.severity === 'error')).toBe(
        false,
      );

    const committed = paramDev(res, ref.parameters);
    fitDev(res, fitRef[variantKey]!, committed);
    const tight = paramDev(res, tightRef[variantKey]!.parameters);
    fitDev(res, tightRef[variantKey]!.fit, tight);

    process.stdout.write(
      `[cb ref] ${file.replace('.json', '').padEnd(36)} committed: est ${fmt(committed.est)} se ${fmt(committed.se)} std ${fmt(committed.std)} p ${fmt(committed.p)} fit ${fmt(committed.fit)} [${committed.fitWorst}] ci ${fmt(committed.ci)} | tight: est ${fmt(tight.est)} se ${fmt(tight.se)} std ${fmt(tight.std)} fit ${fmt(tight.fit)} [${tight.fitWorst}] ~0 ${fmt(tight.fitAbsZero)} ci ${fmt(tight.ci)} | ${ms.toFixed(0)} ms\n`,
    );

    // tight lavaan optimum: the full tolerances
    expect(tight.est).toBeLessThan(1e-6);
    expect(tight.se).toBeLessThan(1e-5);
    expect(tight.std).toBeLessThan(1e-6);
    expect(tight.fit).toBeLessThan(1e-6);
    expect(tight.fitAbsZero).toBeLessThan(1e-7);
    expect(tight.ci).toBeLessThan(1e-5);
    // committed lavaan run: limited by lavaan's own stopping rule (documented above)
    const lavaanSlack = tightRef[variantKey]!.max_est_change;
    expect(committed.est).toBeLessThan(1e-6 + 1.1 * lavaanSlack);
    expect(committed.se).toBeLessThan(1e-5);
    expect(committed.std).toBeLessThan(1e-6 + 1.1 * lavaanSlack);
    expect(committed.p).toBeLessThan(1e-7);
    expect(committed.fit).toBeLessThan(1e-5);
    expect(committed.fitAbsZero).toBeLessThan(1e-7);
    expect(committed.ci).toBeLessThan(1e-5);
  });
});
