/// <reference lib="webworker" />
/**
 * Runs `estimate()` off the main thread. For PLS bootstrap runs it owns the sequential index
 * stream (inside the engine) and sends the draws to a pool of draw workers.
 */
import { DrawPool, type PoolWorker } from './pool';
import type {
  FromDrawWorker,
  FromEstimateWorker,
  ToDrawWorker,
  ToEstimateWorker,
} from './protocol';
import { CANCELLED_OUTCOME, runCore } from './run-core';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: FromEstimateWorker): void => scope.postMessage(m);

function realWorker(): PoolWorker {
  const w = new Worker(new URL('./draw.worker.ts', import.meta.url), { type: 'module' });
  return {
    post: (m: ToDrawWorker) => w.postMessage(m),
    terminate: () => w.terminate(),
    onMessage: (cb) => (w.onmessage = (e: MessageEvent<FromDrawWorker>) => cb(e.data)),
    onError: (cb) => {
      w.onerror = () => cb();
      w.onmessageerror = () => cb();
    },
  };
}

let cancelled = false;
const abort = new AbortController();
let pool: DrawPool | null = null;

scope.onmessage = (e: MessageEvent<ToEstimateWorker>) => {
  const m = e.data;
  if (m.type === 'cancel') {
    cancelled = true;
    abort.abort();
    pool?.terminate();
    return;
  }
  if (m.type !== 'run') return;
  const wantPool =
    m.options.poolSize > 1 &&
    m.input.analysis.method !== 'cb-sem' &&
    m.input.analysis.bootstrap?.enabled === true &&
    typeof Worker !== 'undefined';
  pool = wantPool ? new DrawPool(realWorker, m.options.poolSize) : null;
  const executeDraws = pool && pool.size > 0 ? pool.executeDraws : undefined;
  void runCore(m.input, {
    onProgress: (event) => post({ type: 'progress', event }),
    isCancelled: () => cancelled,
    signal: abort.signal,
    batchSize: m.options.batchSize,
    ...(executeDraws ? { executeDraws } : {}),
  }).then((outcome) => {
    pool?.terminate();
    post({ type: 'done', outcome: cancelled && outcome.ok ? CANCELLED_OUTCOME : outcome });
  });
};
