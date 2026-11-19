/**
 * Browser CB-SEM engine: ML / MLR estimation of reflective SEM models (complete data or FIML),
 * reproducing lavaan 0.7 `sem()` defaults. See README.md in this directory for conventions.
 */
import type {
  AnalysisConfiguration,
  FitIndex,
  NormalizedSemResult,
  ParameterEstimate,
  ResultWarning,
  SemModel,
} from '@sem-studio/contracts';
import { type CbDataInput, emSaturated, prepareData } from './data.ts';
import {
  Z_975,
  pTwoSidedNormal,
  pchisqUpper,
  pnchisq,
  rmseaCi,
  rmseaClosePvalue,
  rmseaPoint,
} from './distributions.ts';
import { computeVcov, h0Trace, h1Trace } from './inference.ts';
import { Mat, cholesky, symEigen, symEigenvalues } from './matrix.ts';
import { type SampleData, evaluate } from './objective.ts';
import { minimize } from './optimize.ts';
import {
  independenceParameterization,
  modelParameterization,
  modelState,
  saturatedParameterization,
  saturatedTheta,
} from './parameterization.ts';
import { type ModelSpec, buildSpec, sampleMoments } from './spec.ts';
import { startValues } from './start.ts';

export const CB_ENGINE_VERSION = '0.1.0';

export type CbErrorCode =
  | 'REQUEST_INVALID'
  | 'DATA_COLUMN_MISSING'
  | 'DATA_NOT_NUMERIC'
  | 'DATA_INSUFFICIENT_ROWS'
  | 'DATA_ZERO_VARIANCE'
  | 'MODEL_NOT_IDENTIFIED'
  | 'ENGINE_NONCONVERGENCE'
  | 'ENGINE_INADMISSIBLE'
  | 'CAPABILITY_UNSUPPORTED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'ENGINE_INTERNAL';

export interface CbError {
  code: CbErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface CbInput {
  model: SemModel;
  analysis: AnalysisConfiguration;
  data: CbDataInput;
}

export interface CbHooks {
  onProgress?: (event: { stage: 'validating' | 'estimating' | 'summarizing' }) => void;
  signal?: AbortSignal;
}

export type CbOutcome = { ok: true; result: NormalizedSemResult } | { ok: false; error: CbError };

const LOG_2PI = Math.log(2 * Math.PI);

export function estimateCbSync(input: CbInput, hooks?: CbHooks): CbOutcome {
  const startedAt = new Date().toISOString();
  const err = (
    code: CbErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): CbOutcome => ({
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
  });
  const cancelled = (): boolean => hooks?.signal?.aborted === true;
  hooks?.onProgress?.({ stage: 'validating' });

  const { model, analysis } = input;
  if (analysis.method !== 'cb-sem')
    return err('REQUEST_INVALID', `The CB engine cannot run method ${analysis.method}.`, {
      reason: 'method',
    });
  const estimator = analysis.estimator.toUpperCase();
  if (estimator !== 'ML' && estimator !== 'MLR')
    return err(
      'CAPABILITY_UNSUPPORTED',
      `Estimator ${analysis.estimator} is not implemented in the browser CB engine (ML and MLR are).`,
      {
        reason: 'estimator',
        estimator: analysis.estimator,
      },
    );
  if (analysis.bootstrap?.enabled)
    return err(
      'CAPABILITY_UNSUPPORTED',
      'Bootstrap inference for CB-SEM is not implemented in the browser engine.',
      {
        reason: 'cb-bootstrap',
      },
    );
  const robust = estimator === 'MLR';
  const fiml = analysis.missingData === 'fiml';
  const identification = analysis.cb?.identification ?? 'marker';
  const requestedMeans = analysis.cb?.meanStructure ?? false;
  const meanStructure = requestedMeans || fiml;
  const warnings: ResultWarning[] = [];
  const messages: string[] = [];
  if (fiml && !requestedMeans)
    warnings.push({
      code: 'CB_MEANSTRUCTURE_ADDED',
      severity: 'info',
      message:
        'FIML requires a mean structure; indicator intercepts were added (as lavaan does for missing = "ml").',
    });

  const built = buildSpec(model, identification, meanStructure);
  if (!built.ok) return err(built.error.code, built.error.message, built.error.details);
  const spec = built.spec;
  const moments = sampleMoments(spec.p, meanStructure);
  const df = moments - spec.npar;
  if (df < 0)
    return err(
      'MODEL_NOT_IDENTIFIED',
      `The model has more free parameters (${spec.npar}) than sample moments (${moments}); df = ${df} < 0 (t-rule).`,
      { reason: 't-rule', npar: spec.npar, moments, df },
    );

  const prep = prepareData(model, spec.ovIds, input.data, fiml ? 'fiml' : 'listwise');
  if (!prep.ok) return err(prep.error.code, prep.error.message, prep.error.details);
  const { data, nUsed } = prep.value;
  const N = data.n;
  if (data.complete && meanStructure === false && !data.mean)
    return err('ENGINE_INTERNAL', 'complete-data moments missing');
  if (!fiml && !data.complete) return err('ENGINE_INTERNAL', 'listwise data are incomplete');

  // h1 (saturated) moments
  let h1Sigma: Mat;
  let h1Mu: Float64Array;
  if (data.complete) {
    h1Sigma = data.cov!;
    h1Mu = data.mean!;
  } else {
    const em = emSaturated(data);
    if (!em)
      return err(
        'ENGINE_INADMISSIBLE',
        'The EM estimate of the saturated covariance matrix became singular.',
        {
          reason: 'em-singular',
        },
      );
    if (!em.converged)
      warnings.push({
        code: 'CB_EM_NOT_CONVERGED',
        severity: 'warning',
        message: `The EM algorithm for the saturated (h1) moments did not converge in ${em.iterations} iterations.`,
      });
    h1Sigma = em.sigma;
    h1Mu = em.mu;
  }
  const singular = singularCovarianceError(h1Sigma, spec, model, data.complete);
  if (singular) return { ok: false, error: singular };
  if (N <= spec.npar)
    warnings.push({
      code: 'CB_N_BELOW_PARAMETERS',
      severity: 'warning',
      message: `Only ${N} cases for ${spec.npar} free parameters.`,
    });

  if (cancelled()) return err('CANCELLED', 'Cancelled.');
  hooks?.onProgress?.({ stage: 'estimating' });

  const par = modelParameterization(spec);
  const start = startValues(spec, h1Sigma, h1Mu);
  const opt = minimize(par, data, start);
  if (!opt.converged)
    return err(
      'ENGINE_NONCONVERGENCE',
      `The ML optimiser did not converge (${opt.iterations} iterations${opt.message ? `; ${opt.message}` : ''}).`,
      { iterations: opt.iterations },
    );
  const x = opt.x;
  const st = modelState(spec, x)!;
  messages.push(
    `ML by Fisher scoring with Newton refinement: ${opt.iterations} iterations, max |gradient| ${maxAbs(opt.grad).toExponential(2)}.`,
  );
  if (cancelled()) return err('CANCELLED', 'Cancelled.');

  // --- inference
  const infoKind = robust || fiml ? 'observed' : 'expected';
  const vc = computeVcov(par, data, x, infoKind, robust);
  let seProblem: 'failed' | null = null;
  if (!vc.vcov) {
    seProblem = 'failed';
    warnings.push({
      code: 'CB_INFORMATION_SINGULAR',
      severity: 'warning',
      message:
        vc.problem === 'information-singular'
          ? `The ${infoKind} information matrix is singular (smallest eigenvalue ${(vc.minEigen ?? NaN).toExponential(2)}): the model is empirically under-identified at this solution. Standard errors are not reported.`
          : 'The information matrix could not be computed; standard errors are not reported.',
    });
  }

  hooks?.onProgress?.({ stage: 'summarizing' });

  // --- admissibility (lavaan post.check)
  const adm = admissibility(spec, st);
  warnings.push(...adm.warnings);

  // --- fit
  const fit = fitMeasures({
    spec,
    data,
    x,
    f: opt.f,
    df,
    h1Sigma,
    h1Mu,
    robust,
    fiml,
    infoInverse: vc.infoInverse,
    firstOrder: vc.firstOrder,
    warnings,
  });

  // --- parameters
  const std = standardized(spec, st);
  const sourceMethod = `sem-studio:cb-sem:${estimator}`;
  const parameters: ParameterEstimate[] = [];
  const inferenceMethod = robust ? 'robust-analytic' : 'analytic';
  spec.entries.forEach((e, k) => {
    const ids = {
      ...(e.sourceId ? { sourceId: e.sourceId } : {}),
      ...(e.targetId ? { targetId: e.targetId } : {}),
      ...(e.relationshipId ? { relationshipId: e.relationshipId } : {}),
    };
    const est = e.free >= 0 ? x[e.free]! : e.value;
    if (e.free < 0) {
      parameters.push({
        key: e.key,
        kind: e.kind,
        ...ids,
        scale: 'unstandardized',
        est,
        se: null,
        statistic: null,
        pValue: null,
        ciLower: null,
        ciUpper: null,
        missing: {
          se: 'not-applicable',
          statistic: 'not-applicable',
          pValue: 'not-applicable',
          ciLower: 'not-applicable',
          ciUpper: 'not-applicable',
        },
        status: 'fixed',
        sourceMethod,
        rawPath: e.where,
      });
    } else {
      const variance = vc.vcov ? vc.vcov.get(e.free, e.free) : NaN;
      const se = variance >= 0 ? Math.sqrt(variance) : NaN;
      if (!Number.isFinite(se)) {
        const reason = seProblem ?? 'non-finite';
        parameters.push({
          key: e.key,
          kind: e.kind,
          ...ids,
          scale: 'unstandardized',
          est,
          se: null,
          statistic: null,
          pValue: null,
          ciLower: null,
          ciUpper: null,
          missing: {
            se: reason,
            statistic: reason,
            pValue: reason,
            ciLower: reason,
            ciUpper: reason,
          },
          status: 'estimated',
          sourceMethod,
          rawPath: e.where,
        });
      } else {
        const z = se > 0 ? est / se : NaN;
        const zOk = Number.isFinite(z);
        parameters.push({
          key: e.key,
          kind: e.kind,
          ...ids,
          scale: 'unstandardized',
          est,
          se,
          statistic: zOk ? z : null,
          statisticType: 'z',
          pValue: zOk ? pTwoSidedNormal(z) : null,
          ciLower: est - Z_975 * se,
          ciUpper: est + Z_975 * se,
          ...(zOk ? {} : { missing: { statistic: 'non-finite', pValue: 'non-finite' } }),
          status: 'estimated',
          inference: { method: inferenceMethod, level: 0.95, sides: 'two-sided' },
          sourceMethod,
          rawPath: e.where,
        });
      }
    }
    const sv = std[k]!;
    const stdMissing = {
      se: 'not-supported',
      statistic: 'not-supported',
      pValue: 'not-supported',
      ciLower: 'not-supported',
      ciUpper: 'not-supported',
    } as const;
    parameters.push({
      key: e.key,
      kind: e.kind,
      ...ids,
      scale: 'standardized',
      est: Number.isFinite(sv) ? sv : null,
      se: null,
      statistic: null,
      pValue: null,
      ciLower: null,
      ciUpper: null,
      missing: Number.isFinite(sv) ? stdMissing : { ...stdMissing, est: 'non-finite' },
      status: e.mat === 'alpha' ? 'fixed' : 'estimated',
      sourceMethod: `${sourceMethod}:std.all`,
      rawPath: `std.all:${e.where}`,
    });
  });

  // --- construct metrics: R² of endogenous factors
  const constructMetrics: NormalizedSemResult['constructMetrics'] = spec.lvIds.map((cid, j) => {
    if (!spec.endogenous[j])
      return {
        constructId: cid,
        metric: 'r2',
        value: null,
        missing: 'not-applicable' as const,
        definition: 'R² of an exogenous factor is not defined.',
      };
    const r2 = 1 - st.mats.psi.get(j, j) / st.phi.get(j, j);
    return Number.isFinite(r2)
      ? {
          constructId: cid,
          metric: 'r2',
          value: r2,
          definition: 'R² = 1 − ψ_jj / Var(η_j), model-implied.',
        }
      : {
          constructId: cid,
          metric: 'r2',
          value: null,
          missing: 'non-finite' as const,
          definition: 'R² = 1 − ψ_jj / Var(η_j), model-implied.',
        };
  });

  // --- latent correlation matrix
  const latentValues: (number | null)[][] = spec.lvIds.map((_, a) =>
    spec.lvIds.map((__, b) => {
      const v = st.phi.get(a, b) / Math.sqrt(st.phi.get(a, a) * st.phi.get(b, b));
      return Number.isFinite(v) ? v : null;
    }),
  );
  const latentBad = latentValues.some((r) => r.some((v) => v === null));
  const matrices: NormalizedSemResult['matrices'] = [
    {
      id: 'latent-correlations',
      title: 'Model-implied factor correlations',
      rowIds: spec.lvIds,
      colIds: spec.lvIds,
      values: latentValues,
      symmetric: true,
      definition: 'Φ = (I − B)⁻¹ Ψ (I − B)⁻ᵀ scaled to unit diagonal.',
      ...(latentBad ? { missing: 'non-finite' as const } : {}),
    },
  ];

  const result: NormalizedSemResult = {
    schemaVersion: 1,
    sample: {
      nRows: input.data.nRows,
      nUsed,
      nDropped: input.data.nRows - nUsed,
      missingData: fiml ? 'fiml' : 'listwise',
    },
    estimation: {
      converged: true,
      iterations: opt.iterations,
      admissible: adm.admissible,
      messages,
    },
    parameters,
    constructMetrics,
    matrices,
    fit,
    warnings,
    provenance: {
      engine: 'browser',
      packageVersions: { '@sem-studio/engine/cb': CB_ENGINE_VERSION, 'ml-matrix': '6.15.1' },
      call: `estimateCb(estimator=${estimator}, missing=${fiml ? 'fiml' : 'listwise'}, identification=${identification}, meanStructure=${meanStructure})`,
      startedAt,
      finishedAt: new Date().toISOString(),
    },
  };
  return { ok: true, result };
}

function maxAbs(v: Float64Array): number {
  return v.reduce((m, a) => Math.max(m, Math.abs(a)), 0);
}

/** Non-PD sample covariance: report the near-linear dependency among indicators. */
function singularCovarianceError(
  S: Mat,
  spec: ModelSpec,
  model: SemModel,
  complete: boolean,
): CbError | null {
  if (cholesky(S)) {
    const ev = symEigenvalues(S);
    const max = ev[0]!;
    const min = ev[ev.length - 1]!;
    if (min > 1e-12 * max) return null;
  }
  const { values, vectors } = symEigen(S);
  const k = values.length - 1;
  const coef = spec.ovIds.map((_, i) => vectors.get(i, k));
  const big = coef
    .map((c, i) => ({ c, i }))
    .filter((t) => Math.abs(t.c) > 1e-3 * Math.max(...coef.map(Math.abs)));
  // express the variable with the largest coefficient through the others
  big.sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
  const name = (i: number): string => {
    const id = spec.ovIds[i]!;
    return model.indicators.find((ind) => ind.id === id)?.name ?? id;
  };
  const lead = big[0]!;
  const rhs = big
    .slice(1)
    .map((t) => {
      const w = -t.c / lead.c;
      return `${w >= 0 ? '+' : '−'} ${Math.abs(w).toFixed(3)}·${name(t.i)}`;
    })
    .join(' ')
    .replace(/^\+ /, '');
  return {
    code: 'DATA_ZERO_VARIANCE',
    message: `The ${complete ? 'sample' : 'EM-estimated'} covariance matrix of the indicators is singular (smallest eigenvalue ${values[k]!.toExponential(2)}): a linear combination of indicators has zero variance, ${name(lead.i)} ≈ ${rhs}. Remove one of the linearly dependent indicators.`,
    details: {
      reason: 'singular-covariance',
      elementIds: big.map((t) => spec.ovIds[t.i]!),
      dependency: Object.fromEntries(big.map((t) => [spec.ovIds[t.i]!, t.c / lead.c])),
      smallestEigenvalue: values[k],
    },
  };
}

function psdOk(m: Mat): boolean {
  if (m.r === 0) return true;
  const ev = symEigenvalues(m);
  const tol = Math.pow(Number.EPSILON, 0.75) * Math.max(1, Math.abs(ev[0]!));
  return !ev.some((v) => v < -tol);
}

function admissibility(
  spec: ModelSpec,
  st: NonNullable<ReturnType<typeof modelState>>,
): { admissible: boolean; warnings: ResultWarning[] } {
  const warnings: ResultWarning[] = [];
  const negOv = spec.ovIds.filter((_, i) => st.mats.theta.get(i, i) < 0);
  const negLv = spec.lvIds.filter((_, j) => st.mats.psi.get(j, j) < 0);
  let ok = true;
  if (negOv.length) {
    ok = false;
    warnings.push({
      code: 'CB_NEGATIVE_VARIANCE',
      severity: 'warning',
      message: `Negative residual variance estimate (Heywood case) for ${negOv.join(', ')}: the solution is inadmissible; the standardized loading exceeds 1 in absolute value. Do not interpret the fit of this solution.`,
      elementIds: negOv,
    });
  }
  if (negLv.length) {
    ok = false;
    warnings.push({
      code: 'CB_NEGATIVE_VARIANCE',
      severity: 'warning',
      message: `Negative (residual) variance estimate for factor(s) ${negLv.join(', ')}: the solution is inadmissible.`,
      elementIds: negLv,
    });
  }
  let phiOk = true;
  if (!negLv.length && spec.m > 0 && !psdOk(st.phi)) {
    ok = phiOk = false;
    warnings.push({
      code: 'CB_LATENT_COV_NOT_PD',
      severity: 'warning',
      message:
        'The covariance matrix of the latent variables is not positive definite (e.g. a factor correlation beyond ±1).',
      elementIds: spec.lvIds,
    });
  }
  let thetaOk = true;
  if (!negOv.length && !psdOk(st.mats.theta)) {
    ok = thetaOk = false;
    warnings.push({
      code: 'CB_THETA_NOT_PD',
      severity: 'warning',
      message: 'The residual covariance matrix of the indicators (Θ) is not positive definite.',
      elementIds: spec.ovIds,
    });
  }
  if (!negOv.length && !negLv.length && phiOk && thetaOk && spec.m > 0 && !psdOk(st.mats.psi)) {
    ok = false;
    warnings.push({
      code: 'CB_PSI_NOT_PD',
      severity: 'warning',
      message: 'The covariance matrix of the structural residuals (Ψ) is not positive definite.',
      elementIds: spec.lvIds,
    });
  }
  return { admissible: ok, warnings };
}

/** lavaan std.all (cov.std = TRUE). Values may be NaN (reported as null). */
function standardized(spec: ModelSpec, st: NonNullable<ReturnType<typeof modelState>>): number[] {
  const sdOv = spec.ovIds.map((_, i) => Math.sqrt(st.sigma.get(i, i)));
  const sdLv = spec.lvIds.map((_, j) => Math.sqrt(st.phi.get(j, j)));
  return spec.entries.map((e) => {
    const r = e.row;
    const c = e.col;
    switch (e.mat) {
      case 'lambda':
        return (st.mats.lambda.get(r, c) * sdLv[c]!) / sdOv[r]!;
      case 'beta':
        return (st.mats.beta.get(r, c) * sdLv[c]!) / sdLv[r]!;
      case 'psi':
        return r === c
          ? st.mats.psi.get(r, r) / st.phi.get(r, r)
          : st.mats.psi.get(r, c) / Math.sqrt(st.mats.psi.get(r, r) * st.mats.psi.get(c, c));
      case 'theta':
        return r === c
          ? st.mats.theta.get(r, r) / st.sigma.get(r, r)
          : st.mats.theta.get(r, c) / Math.sqrt(st.mats.theta.get(r, r) * st.mats.theta.get(c, c));
      case 'nu':
        return st.mats.nu[r]! / sdOv[r]!;
      case 'alpha':
        return st.mats.alpha[r]! / sdLv[r]!;
    }
    return NaN;
  });
}

// ------------------------------------------------------------------ fit

interface FitInput {
  spec: ModelSpec;
  data: SampleData;
  x: Float64Array;
  f: number;
  df: number;
  h1Sigma: Mat;
  h1Mu: Float64Array;
  robust: boolean;
  fiml: boolean;
  infoInverse: Mat | null;
  firstOrder: Mat | null;
  warnings: ResultWarning[];
}

/** |t| below lavaan's all.equal tolerance counts as zero (lav_fit_cfi). */
function nearZero(t: number): boolean {
  return Math.abs(t) < 1.5e-8;
}

export function cfiValue(x2: number, df: number, x2n: number, dfn: number, c = 1, cn = 1): number {
  const useC = df > 0 && c !== 1 && cn !== 1;
  const t1 = Math.max(x2 - (useC ? c : 1) * df, 0);
  const t2 = Math.max(x2 - (useC ? c : 1) * df, x2n - (useC ? cn : 1) * dfn, 0);
  if (nearZero(t1) && nearZero(t2)) return 1;
  return 1 - t1 / t2;
}

export function tliValue(x2: number, df: number, x2n: number, dfn: number, c = 1, cn = 1): number {
  const useC = df > 0 && c !== 1 && cn !== 1;
  const t1 = (x2 - (useC ? c : 1) * df) * dfn;
  const t2 = (x2n - (useC ? cn : 1) * dfn) * df;
  if (df > 0 && Math.abs(t2) > 0) return 1 - t1 / t2;
  return 1;
}

function fitMeasures(inp: FitInput): FitIndex[] {
  const { spec, data, x, df, robust, fiml } = inp;
  const N = data.n;
  const p = spec.p;
  const out: FitIndex[] = [];
  const add = (
    name: string,
    value: number | null,
    definition: string,
    extra: Partial<Pick<FitIndex, 'variant' | 'ciLower' | 'ciUpper' | 'missing'>> = {},
    reason: FitIndex['missing'] = 'non-finite',
  ): void => {
    const ok = value !== null && Number.isFinite(value);
    out.push({
      name,
      value: ok ? value : null,
      ...(ok ? {} : { missing: extra.missing ?? reason }),
      ...(extra.variant ? { variant: extra.variant } : {}),
      ...(extra.ciLower !== undefined ? { ciLower: extra.ciLower } : {}),
      ...(extra.ciUpper !== undefined ? { ciUpper: extra.ciUpper } : {}),
      definition,
    });
  };
  const na = (
    name: string,
    definition: string,
    reason: NonNullable<FitIndex['missing']>,
    variant?: FitIndex['variant'],
  ) => add(name, null, definition, { missing: reason, ...(variant ? { variant } : {}) });

  const meanStructure = spec.meanStructure;
  const muH1 = meanStructure ? inp.h1Mu : null;
  const fH1 = evaluate(data, { sigma: inp.h1Sigma, mu: muH1 })!.f;
  const constant = data.patterns.reduce((s, k) => s + k.n * k.obs.length, 0) * LOG_2PI;
  const logl = -0.5 * (N * inp.f + constant);
  const loglH1 = -0.5 * (N * fH1 + constant);
  const x2 = Math.max(N * (inp.f - fH1), 0);

  // baseline (independence) model: closed form (per-variable available-case ML moments)
  const varB = new Float64Array(p);
  const muB = new Float64Array(p);
  {
    const cnt = new Float64Array(p);
    for (const pat of data.patterns)
      pat.obs.forEach((j, i) => {
        muB[j] = muB[j]! + pat.n * pat.mean[i]!;
        cnt[j] = cnt[j]! + pat.n;
      });
    for (let j = 0; j < p; j++) muB[j] = muB[j]! / cnt[j]!;
    for (const pat of data.patterns)
      pat.obs.forEach((j, i) => {
        varB[j] = varB[j]! + pat.n * (pat.cov.get(i, i) + (pat.mean[i]! - muB[j]!) ** 2);
      });
    for (let j = 0; j < p; j++) varB[j] = varB[j]! / cnt[j]!;
  }
  const sigmaB = Mat.zeros(p, p);
  for (let j = 0; j < p; j++) sigmaB.set(j, j, varB[j]!);
  const fB = evaluate(data, { sigma: sigmaB, mu: meanStructure ? muB : null })!.f;
  const x2B = N * (fB - fH1);
  const dfB = (p * (p - 1)) / 2;

  const justId = df === 0;
  add(
    'chisq',
    x2,
    'Likelihood-ratio χ² against the saturated model, N·(F − F_h1) (lavaan: N·F_ML).',
    { variant: 'standard' },
  );
  add('df', df, 'Degrees of freedom: sample moments − free parameters.');
  if (justId)
    na('pvalue', 'p value of the χ² test (not defined for df = 0).', 'not-applicable', 'standard');
  else
    add('pvalue', pchisqUpper(x2, df), 'p value of the χ² test, P(χ²_df > X²).', {
      variant: 'standard',
    });
  add('baseline.chisq', x2B, 'χ² of the independence (baseline) model.', { variant: 'standard' });
  add('baseline.df', dfB, 'Degrees of freedom of the independence model, p(p−1)/2.');
  add('baseline.pvalue', pchisqUpper(x2B, dfB), 'p value of the baseline χ² test.', {
    variant: 'standard',
  });

  const cfiDef = 'CFI = 1 − max(X² − df, 0) / max(X² − df, X²_B − df_B, 0).';
  const tliDef = 'TLI = (X²_B/df_B − X²/df) / (X²_B/df_B − 1).';
  const rmseaDef =
    'RMSEA = sqrt(max(X²/(N·df) − 1/N, 0)); 90% CI by noncentral χ² inversion (lavaan uniroot convention).';
  const srmrDef = meanStructure
    ? "SRMR (Bentler): root mean square of covariance residuals scaled by the observed SDs, including the standardized mean residuals (lavaan 'srmr')."
    : "SRMR (Bentler): root mean square of the covariance residuals scaled by the observed SDs, diagonal included (lavaan 'srmr').";
  if (justId) {
    na(
      'cfi',
      `${cfiDef} Not informative for a just-identified model (df = 0).`,
      'not-applicable',
      'standard',
    );
    na('tli', `${tliDef} Not informative for df = 0.`, 'not-applicable', 'standard');
    na('rmsea', `${rmseaDef} Not informative for df = 0.`, 'not-applicable', 'standard');
    na(
      'rmsea.pvalue',
      'Close-fit test P(RMSEA ≤ .05); not defined for df = 0.',
      'not-applicable',
      'standard',
    );
    na('srmr', `${srmrDef} Zero by construction for df = 0.`, 'not-applicable', 'standard');
    inp.warnings.push({
      code: 'CB_JUST_IDENTIFIED',
      severity: 'info',
      message:
        'The model is just-identified (df = 0): it reproduces the sample moments exactly, so χ² = 0 and the global fit indices carry no information about fit.',
    });
  } else {
    add('cfi', cfiValue(x2, df, x2B, dfB), cfiDef, { variant: 'standard' });
    add('tli', tliValue(x2, df, x2B, dfB), tliDef, { variant: 'standard' });
    const ci = rmseaCi(x2, df, N);
    add('rmsea', rmseaPoint(x2, df, N), rmseaDef, {
      variant: 'standard',
      ciLower: ci.lower,
      ciUpper: ci.upper,
    });
    add(
      'rmsea.pvalue',
      rmseaClosePvalue(x2, df, N, 0.05),
      'Close-fit test P(RMSEA ≤ .05): 1 − F(X²; df, λ = N·df·0.05²).',
      {
        variant: 'standard',
      },
    );
    add('srmr', srmrBentler(inp.h1Sigma, muH1, modelState(spec, x)!), srmrDef, {
      variant: 'standard',
    });
  }
  const npar = spec.npar;
  add('logl', logl, 'Log-likelihood of the fitted model.');
  add('unrestricted.logl', loglH1, 'Log-likelihood of the saturated (h1) model.');
  add('aic', -2 * logl + 2 * npar, 'AIC = −2 logL + 2·npar.');
  add('bic', -2 * logl + npar * Math.log(N), 'BIC = −2 logL + npar·ln N.');
  add(
    'bic2',
    -2 * logl + npar * Math.log((N + 2) / 24),
    'Sample-size adjusted BIC = −2 logL + npar·ln((N + 2)/24).',
  );
  add('npar', npar, 'Number of free parameters.');
  add('ntotal', N, 'Number of cases used.');

  if (!robust) return out;

  // ---- MLR: Yuan–Bentler (Mplus variant) scaled test
  const scaledNames = [
    'chisq',
    'chisq.scaling.factor',
    'pvalue',
    'baseline.chisq',
    'baseline.chisq.scaling.factor',
    'cfi',
    'tli',
    'rmsea',
  ];
  if (justId) {
    for (const nm of scaledNames)
      na(nm, 'Yuan–Bentler scaled statistic: not defined for df = 0.', 'not-applicable', 'scaled');
    for (const nm of ['cfi', 'tli', 'rmsea'])
      na(nm, 'Robust fit index: not defined for df = 0.', 'not-applicable', 'robust');
    return out;
  }
  const sat = saturatedParameterization(p, meanStructure);
  const trH1 = h1Trace(sat, data, saturatedTheta(inp.h1Sigma, muH1));
  const par = modelParameterization(spec);
  const trH0 = h0Trace(par, data, x, inp.infoInverse, inp.firstOrder);
  const indep = independenceParameterization(p, meanStructure);
  const xB = Float64Array.from([...varB, ...(meanStructure ? muB : [])]);
  const trB0 = h0Trace(indep, data, xB);
  if (trH1 === null || trH0 === null || trB0 === null) {
    for (const nm of scaledNames)
      na(nm, 'Yuan–Bentler scaled statistic (computation failed).', 'failed', 'scaled');
    return out;
  }
  const trace = trH1 - trH0;
  const c = trace / df;
  const cB = (trH1 - trB0) / dfB;
  const x2s = x2 / c;
  const x2Bs = x2B / cB;
  const ybDef =
    'Yuan–Bentler scaled χ² (Mplus variant, lavaan "yuan.bentler.mplus"): X²/c, c = [tr(B₁A₁⁻¹) − tr(B₀I⁻¹)]/df.';
  add('chisq', x2s, ybDef, { variant: 'scaled' });
  add('chisq.scaling.factor', c, 'Scaling factor c of the Yuan–Bentler test.', {
    variant: 'scaled',
  });
  add('pvalue', 1 - pnchisq(x2s, df, 0), 'p value of the scaled χ² test.', { variant: 'scaled' });
  add('baseline.chisq', x2Bs, 'Yuan–Bentler scaled χ² of the independence model.', {
    variant: 'scaled',
  });
  add('baseline.chisq.scaling.factor', cB, 'Scaling factor of the baseline Yuan–Bentler test.', {
    variant: 'scaled',
  });
  add(
    'cfi',
    cfiValue(x2s, df, x2Bs, dfB),
    'CFI computed from the scaled χ² of the model and the baseline (lavaan cfi.scaled).',
    {
      variant: 'scaled',
    },
  );
  add(
    'tli',
    tliValue(x2s, df, x2Bs, dfB),
    'TLI computed from the scaled χ² statistics (lavaan tli.scaled).',
    { variant: 'scaled' },
  );
  {
    const ci = rmseaCi(x2, trace, N);
    add(
      'rmsea',
      rmseaPoint(x2, trace, N),
      'RMSEA with df replaced by tr(UΓ) (lavaan rmsea.scaled), 90% CI likewise.',
      {
        variant: 'scaled',
        ciLower: ci.lower,
        ciUpper: ci.upper,
      },
    );
  }
  if (fiml) {
    const why =
      'Robust (Brosseau-Liard–Savalei / Savalei FIML-corrected) index: not implemented for FIML in the browser engine.';
    na('cfi', why, 'not-supported', 'robust');
    na('tli', why, 'not-supported', 'robust');
    na('rmsea', why, 'not-supported', 'robust');
  } else {
    add(
      'cfi',
      cfiValue(x2, df, x2B, dfB, c, cB),
      'Robust CFI (Brosseau-Liard & Savalei 2014; lavaan cfi.robust).',
      {
        variant: 'robust',
      },
    );
    add('tli', tliValue(x2, df, x2B, dfB, c, cB), 'Robust TLI (lavaan tli.robust).', {
      variant: 'robust',
    });
    const ci = rmseaCi(x2s, df, N, c);
    add(
      'rmsea',
      rmseaPoint(x2, df, N, c),
      'Robust RMSEA (Brosseau-Liard, Savalei & Li 2012; lavaan rmsea.robust), 90% CI.',
      {
        variant: 'robust',
        ciLower: ci.lower,
        ciUpper: ci.upper,
      },
    );
  }
  return out;
}

/** Bentler SRMR (lavaan "srmr"; with a mean structure the standardized mean residuals are included). */
function srmrBentler(
  S: Mat,
  m: Float64Array | null,
  st: NonNullable<ReturnType<typeof modelState>>,
): number {
  const p = S.r;
  let ss = 0;
  let cnt = 0;
  for (let i = 0; i < p; i++)
    for (let j = 0; j <= i; j++) {
      const r = (S.get(i, j) - st.sigma.get(i, j)) / Math.sqrt(S.get(i, i) * S.get(j, j));
      ss += r * r;
      cnt++;
    }
  if (m && st.mu) {
    for (let i = 0; i < p; i++) {
      const r = (m[i]! - st.mu[i]!) / Math.sqrt(S.get(i, i));
      ss += r * r;
      cnt++;
    }
  }
  return Math.sqrt(ss / cnt);
}
