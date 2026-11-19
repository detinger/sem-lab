/**
 * Messages between the page, the estimate worker and the draw workers. Everything here is
 * structured-clone safe (plain objects, arrays, typed arrays); no functions, no class instances.
 */
import type {
  BootstrapProblem,
  DrawResult,
  EstimateInput,
  ProgressEvent,
} from '@sem-studio/engine';
import type { EstimateResult } from '@sem-studio/engine';

export interface RunOptionsMsg {
  /** number of draw workers; 1 = draws run in the estimate worker itself */
  poolSize: number;
  batchSize: number;
}

export type ToEstimateWorker =
  { type: 'run'; input: EstimateInput; options: RunOptionsMsg } | { type: 'cancel' };

export type FromEstimateWorker =
  { type: 'progress'; event: ProgressEvent } | { type: 'done'; outcome: EstimateResult };

export type ToDrawWorker =
  | { type: 'problem'; problemId: number; problem: BootstrapProblem }
  | { type: 'task'; taskId: number; problemId: number; indices: Int32Array[] };

export type FromDrawWorker =
  | { type: 'result'; taskId: number; results: DrawResult[] }
  | { type: 'error'; taskId: number; message: string };
