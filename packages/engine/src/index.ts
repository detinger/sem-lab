/**
 * @sem-lab/engine — in-browser SEM estimation (pure TypeScript; Web Workers and Node).
 *
 * PLS-SEM / PLSc: `estimatePls` reproduces the R engine (cSEM 0.7.1) reference results in
 * packages/fixtures/reference-results/pls; the bootstrap follows SEM Lab's own definition
 * (see src/pls/bootstrap.ts), reproduced by packages/fixtures/scripts/make_bootstrap_references.R.
 */

// ---- PLS: public entry point -----------------------------------------------------------
export {
  estimatePls,
  ENGINE_VERSION,
  type EstimateHooks,
  type EstimateInput,
  type EstimateOutcome,
  type ProgressEvent,
  type ProgressStage,
} from './pls/estimate.ts';
export type { AnalysisDataInput, PlsSpec } from './pls/spec.ts';
export { validateRequest, prepareData, coreModel } from './pls/spec.ts';

// ---- PLS: lower-level building blocks (parallel bootstrap, tests, exports) -----------------
export {
  bootstrapIndices,
  fitDraw,
  summariseBootstrap,
  inferFromDraws,
  extractTheta,
  type BootstrapProblem,
  type DrawResult,
  type BootstrapCounts,
  type Inference,
  type ThetaSlot,
} from './pls/bootstrap.ts';
export {
  fitPls,
  fitWeights,
  verify,
  modelImpliedIndicatorCor,
  type CoreModel,
  type CoreFit,
  type InnerScheme,
  type VerifyCheck,
} from './pls/core.ts';
export { thetaEntries, type ThetaEntry } from './pls/results.ts';
export { computeEffects, effectsSpec } from './pls/effects.ts';

// ---- shared ----------------------------------------------------------------------------------
export { RMersenneTwister, rSetSeed, runif } from './rng/r-mt.ts';
export { pt, quantile7 } from './shared/stats.ts';
export {
  EngineError,
  ENGINE_ERROR_CODES,
  type EngineErrorCode,
  type EngineErrorInfo,
} from './shared/errors.ts';
export { correlation } from './linalg/index.ts';

// ---- CB-SEM (ML / MLR, complete data or FIML) ---------------------------------------------
export {
  estimateCb,
  estimateCbSync,
  cbParameterCount,
  CB_ENGINE_VERSION,
  type CbDataInput,
  type CbError,
  type CbErrorCode,
  type CbHooks,
  type CbInput,
  type CbOutcome,
} from './cb/index.ts';

// ---- one entry point for the app ------------------------------------------------------------
import type { NormalizedSemResult } from '@sem-lab/contracts';
import { estimateCb as runCb } from './cb/index.ts';
import { type EstimateHooks, type EstimateInput, estimatePls as runPls } from './pls/estimate.ts';

export type EstimateResult =
  | { ok: true; result: NormalizedSemResult }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

/**
 * Estimate with the method in `input.analysis.method`: PLS-SEM / PLSc → PLS engine, CB-SEM →
 * CB engine. Never throws. Cancellation: PLS checks `hooks.isCancelled` between bootstrap
 * draws; CB checks `hooks.signal`.
 */
export async function estimate(
  input: EstimateInput,
  hooks: EstimateHooks & { signal?: AbortSignal } = {},
): Promise<EstimateResult> {
  if (input.analysis.method === 'cb-sem') {
    return runCb(
      { model: input.model, analysis: input.analysis, data: input.data },
      {
        ...(hooks.signal ? { signal: hooks.signal } : {}),
        onProgress: (e) => hooks.onProgress?.({ stage: e.stage }),
      },
    );
  }
  return runPls(input, hooks);
}
