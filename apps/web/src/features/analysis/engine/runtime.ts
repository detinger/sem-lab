/**
 * The in-browser estimation runtime. `runEstimate` runs the engine in a module Web Worker (with a
 * pool of draw workers for the PLS bootstrap) and falls back to the main thread where Workers are
 * unavailable (tests, very old browsers). Results are identical on every path; only speed differs.
 */
import type { AnalysisConfiguration, SemModel } from '@sem-lab/contracts';
import type {
  AnalysisDataInput,
  EstimateInput,
  EstimateResult,
  ProgressEvent,
} from '@sem-lab/engine';
import type { AnalysisData } from '@/domain/dataset/types';
import type { FromEstimateWorker, ToEstimateWorker } from './protocol';
import { CANCELLED_OUTCOME, runCore } from './run-core';

/**
 * The app's analysis matrix as engine input. `EstimateInput.data` is typed for complete rows; the CB
 * engine (CbDataInput) also accepts `null` cells for FIML, which is the only case where they occur.
 */
export function engineInput(
  model: SemModel,
  analysis: AnalysisConfiguration,
  data: AnalysisData,
): EstimateInput {
  return { model, analysis, data: data as unknown as AnalysisDataInput };
}

export type RunOutcome = EstimateResult & { durationMs: number };

export interface RunOptions {
  onProgress?: (e: ProgressEvent) => void;
  /** draw workers for a bootstrap: 'auto' = pool size for this device, 1 = single worker */
  workers?: number | 'auto';
  /** 'main' forces the main-thread fallback */
  mode?: 'auto' | 'main';
}

export interface RunHandle {
  promise: Promise<RunOutcome>;
  cancel: () => void;
}

/** K = max(1, min(cores - 1, 8)) */
export function poolSize(
  cores: number | undefined = globalThis.navigator?.hardwareConcurrency,
): number {
  const c = typeof cores === 'number' && Number.isFinite(cores) ? cores : 2;
  return Math.max(1, Math.min(c - 1, 8));
}

/** draws per progress event / executor batch */
export const batchSizeFor = (k: number): number => (k > 1 ? k * 8 : 25);

const now = (): number => globalThis.performance?.now() ?? Date.now();

function runMain(input: EstimateInput, opts: RunOptions, t0: number): RunHandle {
  let cancelled = false;
  const abort = new AbortController();
  const promise = Promise.resolve()
    .then(() =>
      runCore(input, {
        ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
        isCancelled: () => cancelled,
        signal: abort.signal,
        batchSize: 25,
      }),
    )
    .then((r): RunOutcome => ({ ...r, durationMs: now() - t0 }));
  return {
    promise,
    cancel: () => {
      cancelled = true;
      abort.abort();
    },
  };
}

let workersOverride: number | null = null;
/** Test hook: force the number of draw workers (1 = single worker); null = automatic. */
export function setWorkersOverride(n: number | null): void {
  workersOverride = n;
}

export function runEstimate(input: EstimateInput, opts: RunOptions = {}): RunHandle {
  const t0 = now();
  if (opts.mode === 'main' || typeof Worker === 'undefined') return runMain(input, opts, t0);

  const k =
    opts.workers === undefined || opts.workers === 'auto'
      ? (workersOverride ?? poolSize())
      : Math.max(1, opts.workers);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./estimate.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return runMain(input, opts, t0);
  }
  let settled = false;
  let cancelled = false;
  let hardStop: ReturnType<typeof setTimeout> | undefined;
  let fallback: RunHandle | null = null;
  let resolveFn!: (o: RunOutcome) => void;
  const promise = new Promise<RunOutcome>((res) => (resolveFn = res));
  const settle = (o: EstimateResult): void => {
    if (settled) return;
    settled = true;
    clearTimeout(hardStop);
    worker.terminate();
    resolveFn({ ...o, durationMs: now() - t0 });
  };
  worker.onmessage = (e: MessageEvent<FromEstimateWorker>) => {
    const m = e.data;
    if (m.type === 'progress') opts.onProgress?.(m.event);
    else settle(m.outcome);
  };
  worker.onerror = () => {
    if (settled || cancelled) return;
    // the worker could not run (blocked, unsupported): same job on the main thread
    settled = true;
    worker.terminate();
    fallback = runMain(input, opts, t0);
    void fallback.promise.then(resolveFn);
  };
  const msg: ToEstimateWorker = {
    type: 'run',
    input,
    options: { poolSize: k, batchSize: batchSizeFor(k) },
  };
  worker.postMessage(msg);
  return {
    promise,
    cancel: () => {
      if (settled && !fallback) return;
      cancelled = true;
      fallback?.cancel();
      const c: ToEstimateWorker = { type: 'cancel' };
      worker.postMessage(c);
      // a busy worker may not poll its queue (CB optimiser): stop it outright shortly after
      hardStop = setTimeout(() => settle(CANCELLED_OUTCOME), 1500);
    },
  };
}
