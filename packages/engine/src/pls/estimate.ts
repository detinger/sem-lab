/**
 * estimatePls(): the browser engine's PLS-SEM / PLSc job, the counterpart of
 * services/r-engine/R/run_job.R for methods `pls-sem` and `plsc`. Stages and error codes follow
 * docs/architecture/engine-protocol.md; numbers follow cSEM 0.7.1 (see core.ts) and the
 * normalisation of pls_results.R; the bootstrap is SEM Studio's definition (bootstrap.ts).
 */
import type {
  AnalysisConfiguration,
  NormalizedSemResult,
  ParameterEstimate,
  SemModel,
} from '@sem-studio/contracts';
import { correlation, NumericalError } from '../linalg/index.ts';
import { EngineError, type EngineErrorInfo } from '../shared/errors.ts';
import {
  bootstrapIndices,
  type BootstrapProblem,
  type DrawResult,
  extractTheta,
  fitDraw,
  inferFromDraws,
  summariseBootstrap,
} from './bootstrap.ts';
import { type CoreFit, fitPls, VERIFY_CHECKS, verify } from './core.ts';
import { computeEffects, effectsSpec, type EffectValues } from './effects.ts';
import { computeIpma } from './ipma.ts';
import {
  type BootstrapInference,
  buildConstructMetrics,
  buildFit,
  buildMatrices,
  buildParameters,
  collectWarnings,
  thetaEntries,
} from './results.ts';
import { type AnalysisDataInput, coreModel, prepareData, validateRequest } from './spec.ts';

export const ENGINE_VERSION = '0.1.0';
/** Draws stored in result.bootstrap.draws are rounded to this many significant digits. */
export const DRAW_SIGNIF = 6;

export type ProgressStage = 'validating' | 'estimating' | 'bootstrapping' | 'summarizing';

export interface ProgressEvent {
  stage: ProgressStage;
  done?: number;
  total?: number;
  failed?: number;
  inadmissible?: number;
}

export interface EstimateHooks {
  onProgress?(e: ProgressEvent): void;
  /** polled between bootstrap draws (and before each stage); true ⇒ CANCELLED */
  isCancelled?(): boolean;
  /**
   * Optional parallel executor: fits a batch of resamples (in order) and resolves with their
   * results in the same order — e.g. a Web Worker pool calling `fitDraw`. Default: sequential.
   */
  executeDraws?(problem: BootstrapProblem, batch: Int32Array[]): Promise<DrawResult[]>;
  /** draws per progress event / executor batch (default 25) */
  batchSize?: number;
}

export interface EstimateInput {
  model: SemModel;
  analysis: AnalysisConfiguration;
  data: AnalysisDataInput;
}

export type EstimateOutcome =
  { ok: true; result: NormalizedSemResult } | { ok: false; error: EngineErrorInfo };

function cancelled(stage: string): EngineError {
  return new EngineError('CANCELLED', `The job was cancelled ${stage}.`);
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function signif(x: number, digits: number): number {
  return x === 0 ? 0 : Number(x.toPrecision(digits));
}

function formatTol(x: number): string {
  return String(x);
}

/** Run a PLS-SEM or PLSc analysis. Never throws: errors are returned as `{ ok: false }`. */
export async function estimatePls(
  input: EstimateInput,
  hooks: EstimateHooks = {},
): Promise<EstimateOutcome> {
  try {
    return { ok: true, result: await run(input, hooks) };
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.toInfo() };
    const message =
      e instanceof NumericalError
        ? 'A numerical step of the PLS estimation failed (singular or non-finite system).'
        : 'Unexpected internal error in the browser PLS engine.';
    return { ok: false, error: { code: 'ENGINE_INTERNAL', message } };
  }
}

async function run(input: EstimateInput, hooks: EstimateHooks): Promise<NormalizedSemResult> {
  const startedAt = new Date().toISOString();
  const progress = (e: ProgressEvent): void => hooks.onProgress?.(e);
  const isCancelled = (): boolean => hooks.isCancelled?.() === true;

  progress({ stage: 'validating' });
  const spec = validateRequest(input.model, input.analysis);
  const data = prepareData(spec, input.data);
  if (isCancelled()) throw cancelled('before estimation');

  progress({ stage: 'estimating' });
  const model = coreModel(spec);
  const plsc = spec.method === 'plsc';
  const { S } = correlation(data.columns);
  const n = data.n;
  let fit: CoreFit;
  try {
    fit = fitPls(S, model, plsc, n);
  } catch (e) {
    if (e instanceof NumericalError) {
      throw new EngineError(
        'ENGINE_INTERNAL',
        'The PLS estimation failed (a singular or non-finite system occurred during estimation).',
        { stage: 'estimation' },
      );
    }
    throw e;
  }
  if (!fit.converged) {
    throw new EngineError(
      'ENGINE_NONCONVERGENCE',
      `The PLS weight algorithm did not converge within ${spec.maxIter} iterations (tolerance ${formatTol(spec.tol)}).`,
      { maxIterations: spec.maxIter, tolerance: spec.tol, iterations: fit.iterations },
    );
  }
  const verifyFailed = verify(S, fit, model);
  // rho_A comes from the PLSc correction of the (identical) weights; always available here
  const rhoAvailable = true;

  const theta = thetaEntries(spec);
  const thetaValues = extractTheta(fit, theta);
  const es = effectsSpec(model.k, spec.paths);
  const pathIdx = theta.map((t, i) => (t.kind === 'path' ? i : -1)).filter((i) => i >= 0);
  const effectsOf = (vals: readonly number[]): EffectValues =>
    computeEffects(
      model.k,
      spec.paths,
      pathIdx.map((i) => vals[i]!),
      es,
    );
  const eff = effectsOf(thetaValues);

  // ---- bootstrap -----------------------------------------------------------------------
  let bsInference: BootstrapInference | null = null;
  let bootCounts: ReturnType<typeof summariseBootstrap> | null = null;
  let validEffects: EffectValues[] = [];
  if (spec.bootstrap) {
    if (isCancelled()) throw cancelled('before bootstrapping');
    const B = spec.bootstrap.reps;
    const problem: BootstrapProblem = {
      core: model,
      disattenuate: plsc,
      columns: data.columns,
      theta,
    };
    const batchSize = Math.max(1, hooks.batchSize ?? 25);
    const draws: DrawResult[] = [];
    let failed = 0;
    let inadm = 0;
    progress({ stage: 'bootstrapping', done: 0, total: B, failed: 0, inadmissible: 0 });
    const gen = bootstrapIndices(spec.bootstrap.seed, n, B);
    let lastYield = Date.now();
    while (draws.length < B) {
      const batch: Int32Array[] = [];
      for (let i = 0; i < batchSize && draws.length + batch.length < B; i++)
        batch.push(gen.next().value as Int32Array);
      let results: DrawResult[];
      if (hooks.executeDraws) {
        if (isCancelled()) throw cancelled('during bootstrapping');
        results = await hooks.executeDraws(problem, batch);
        if (results.length !== batch.length) {
          throw new EngineError(
            'ENGINE_INTERNAL',
            'The bootstrap executor returned a wrong number of draws.',
          );
        }
      } else {
        results = [];
        for (const idx of batch) {
          if (isCancelled()) throw cancelled('during bootstrapping');
          results.push(fitDraw(problem, idx));
        }
      }
      for (const r of results) {
        draws.push(r);
        if (r.status === 'failed') failed++;
        else if (r.status === 'inadmissible') inadm++;
      }
      progress({
        stage: 'bootstrapping',
        done: draws.length,
        total: B,
        failed,
        inadmissible: inadm,
      });
      if (Date.now() - lastYield > 30) {
        await yieldToEventLoop();
        lastYield = Date.now();
      }
    }
    if (isCancelled()) throw cancelled('during bootstrapping');
    bootCounts = summariseBootstrap(draws);
    validEffects = bootCounts.valid.map((v) => effectsOf(v));
    const { level, sides } = spec.bootstrap;
    const col = (i: number): number[] => bootCounts!.valid.map((v) => v[i]!);
    bsInference = {
      boot: spec.bootstrap,
      theta: thetaValues.map((est, i) => inferFromDraws(est, col(i), level, sides)),
      total: eff.total.map((est, j) =>
        inferFromDraws(
          est,
          validEffects.map((e) => e.total[j]!),
          level,
          sides,
        ),
      ),
      indirect: eff.indirect.map((est, j) =>
        inferFromDraws(
          est,
          validEffects.map((e) => e.indirect[j]!),
          level,
          sides,
        ),
      ),
      specific: eff.specific.map((est, j) =>
        inferFromDraws(
          est,
          validEffects.map((e) => e.specific[j]!),
          level,
          sides,
        ),
      ),
    };
  }
  if (isCancelled()) throw cancelled('before summarizing');

  // ---- summarise --------------------------------------------------------------------------
  progress({ stage: 'summarizing' });
  const parameters: ParameterEstimate[] = buildParameters(
    spec,
    theta,
    thetaValues,
    es,
    eff,
    bsInference,
  );
  const constructMetrics = buildConstructMetrics(spec, model, fit, S, rhoAvailable);
  const matrices = buildMatrices(spec, model, fit, S, n);
  const fitIdx = buildFit(model, fit, S);
  const warnings = collectWarnings({
    spec,
    reversed: data.reversed,
    verifyFailed,
    theta,
    thetaValues,
    rhoMessage: null,
    truncated: es.truncated,
    boot: bootCounts,
  });
  let ipma: NormalizedSemResult['ipma'];
  const calls: string[] = [
    `PLS-PM (cSEM 0.7.1 semantics) on the Pearson indicator correlation matrix: ${plsc ? 'consistent PLS (PLSc: Mode A weights + consistency correction, correction factor "dist_squared_euclid")' : 'classic PLS-SEM (no consistency correction)'}; reflective blocks Mode A, composite-formative blocks Mode B; starting weights = unit weights scaled to unit composite variance; inner weighting scheme "${spec.scheme}"; convergence: max |W_old - W_new| < ${formatTol(spec.tol)} within ${spec.maxIter} iterations; paths by OLS on the construct correlations; no sign re-orientation.`,
  ];
  if (!plsc && model.commonFactor.some(Boolean)) {
    calls.push('rho_A: PLSc correction (dist_squared_euclid) applied to the same weights.');
  }
  if (spec.bootstrap) {
    calls.push(
      `Bootstrap: set.seed(${spec.bootstrap.seed}, kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection"); for b in 1..${spec.bootstrap.reps}: idx <- sample.int(${n}, ${n}, replace = TRUE), refit the full model; failed (error / no convergence / non-finite) and inadmissible (verify) draws excluded; percentile CI (quantile type 7), p from t(df = B_valid - 1).`,
    );
  }
  if (spec.ipma) {
    const ip = computeIpma(spec, data);
    ipma = ip.result;
    warnings.push(...ip.warnings);
    calls.push(
      `IPMA: classic PLS-SEM (scheme "${spec.scheme}", same tolerance and iteration cap) on the indicators rescaled to 0-100 with their declared endpoints.`,
    );
  }

  const admissible = verifyFailed.length === 0;
  const messages = [
    `PLS weights converged after ${fit.iterations} iteration(s) (tolerance ${formatTol(spec.tol)}, criterion max |W_old - W_new|, at most ${spec.maxIter} iterations).`,
    `Estimator: ${plsc ? 'consistent PLS (PLSc)' : 'classic PLS-SEM (no consistency correction)'}; inner weighting scheme "${spec.scheme}".`,
    ...(admissible
      ? []
      : [
          `Admissibility (cSEM::verify() checks) failed: ${verifyFailed.map((c) => VERIFY_CHECKS[c]).join('; ')}.`,
        ]),
  ].map((m) => m.slice(0, 2000));

  let bootstrap: NormalizedSemResult['bootstrap'];
  if (spec.bootstrap && bootCounts) {
    const drawMap: Record<string, number[]> = {};
    pathIdx.forEach(
      (i) => (drawMap[theta[i]!.key] = bootCounts.valid.map((v) => signif(v[i]!, DRAW_SIGNIF))),
    );
    es.specific.forEach((sp, j) => {
      const key = `specific-indirect:${sp.nodes.map((c) => spec.constructs[c]!.id).join('->')}`;
      if (key.length <= 400)
        drawMap[key] = validEffects.map((e) => signif(e.specific[j]!, DRAW_SIGNIF));
    });
    bootstrap = {
      requested: bootCounts.requested,
      completed: bootCounts.completed,
      failed: bootCounts.failed,
      inadmissible: bootCounts.inadmissible,
      seed: spec.bootstrap.seed,
      ciMethod: 'percentile',
      confidenceLevel: spec.bootstrap.level,
      chunkSize: 1,
      draws: drawMap,
    };
  }

  let call = calls.join('\n');
  if (call.length > 4000) call = `${call.slice(0, 3980)}\n[truncated]`;
  return {
    schemaVersion: 1,
    sample: { nRows: data.nRows, nUsed: n, nDropped: data.nRows - n, missingData: 'listwise' },
    estimation: { converged: true, iterations: fit.iterations, admissible, messages },
    parameters,
    constructMetrics,
    matrices,
    fit: fitIdx,
    ...(bootstrap ? { bootstrap } : {}),
    ...(ipma ? { ipma } : {}),
    warnings,
    provenance: {
      engine: 'browser',
      packageVersions: { '@sem-studio/engine': ENGINE_VERSION },
      call,
      startedAt,
      finishedAt: new Date().toISOString(),
    },
  };
}
