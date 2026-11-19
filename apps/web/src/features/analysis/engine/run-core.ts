/** What runs an estimation, on whatever thread: the engine call with cancellation and progress. */
import {
  type EstimateInput,
  type EstimateResult,
  type ProgressEvent,
  type BootstrapProblem,
  type DrawResult,
  estimate,
} from '@sem-lab/engine';

export interface CoreOptions {
  onProgress?: (e: ProgressEvent) => void;
  isCancelled: () => boolean;
  signal?: AbortSignal;
  batchSize: number;
  executeDraws?: (problem: BootstrapProblem, batch: Int32Array[]) => Promise<DrawResult[]>;
}

export function runCore(input: EstimateInput, o: CoreOptions): Promise<EstimateResult> {
  return estimate(input, {
    isCancelled: o.isCancelled,
    batchSize: o.batchSize,
    ...(o.onProgress ? { onProgress: o.onProgress } : {}),
    ...(o.signal ? { signal: o.signal } : {}),
    ...(o.executeDraws ? { executeDraws: o.executeDraws } : {}),
  });
}

export const CANCELLED_OUTCOME: EstimateResult = {
  ok: false,
  error: { code: 'CANCELLED', message: 'The job was cancelled.' },
};
