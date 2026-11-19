/**
 * Local run controller (PLAN §2.6, overview §3): an analysis runs in this browser, in the engine
 * runtime's Web Workers. Nothing is uploaded and nothing is fetched.
 *
 * - Progress is exactly what the engine reports (real counts); no number is interpolated.
 * - A finished run is written once and never changed (runs.ts). A cancelled run is recorded as
 *   cancelled and carries no result.
 * - Reloading the page ends a running analysis (it lived in a worker of this page).
 */
import type { AnalysisConfiguration, SemModel } from '@sem-lab/contracts';
import type { ProgressEvent } from '@sem-lab/engine';
import { create } from 'zustand';
import type { AnalysisData } from '@/domain/dataset/types';
import { type RunHandle, engineInput, runEstimate } from './engine';
import { NormalizedSemResult } from '@sem-lab/contracts';
import { finishRun, makeRun, saveRun, useRuns } from './runs';

export interface ActiveJob {
  runId: string;
  progress: ProgressEvent | null;
  cancelRequested: boolean;
  startedAt: number;
}

export interface Outcome {
  runId: string;
  status: 'complete' | 'failed' | 'cancelled';
  failure?: { code: string; message: string };
}

export interface StartInput {
  projectId: string;
  model: SemModel;
  analysis: AnalysisConfiguration;
  data: AnalysisData;
  modelHash: string;
  dataFingerprint: string;
}

interface JobsState {
  active: ActiveJob | null;
  /** the last finished job; the page reacts to it once */
  outcome: Outcome | null;
  start: (input: StartInput, opts?: { workers?: number | 'auto' }) => Promise<void>;
  cancel: () => void;
  clearOutcome: () => void;
}

let handle: RunHandle | null = null;

export const useJobs = create<JobsState>()((set, get) => ({
  active: null,
  outcome: null,

  async start(input, opts) {
    if (get().active) return;
    const base = makeRun({
      projectId: input.projectId,
      model: input.model,
      analysis: input.analysis,
      modelHash: input.modelHash,
      dataFingerprint: input.dataFingerprint,
    });
    set({
      outcome: null,
      active: { runId: base.runId, progress: null, cancelRequested: false, startedAt: Date.now() },
    });
    const h = runEstimate(engineInput(input.model, input.analysis, input.data), {
      workers: opts?.workers ?? 'auto',
      onProgress: (e) =>
        set((s) => (s.active?.runId === base.runId ? { active: { ...s.active, progress: e } } : s)),
    });
    handle = h;
    const out = await h.promise;
    handle = null;
    let finished;
    try {
      if (out.ok) {
        // an invalid result is an error, never shown
        const parsed = NormalizedSemResult.safeParse(out.result);
        finished = parsed.success
          ? finishRun(base, { status: 'complete', result: parsed.data, durationMs: out.durationMs })
          : finishRun(base, {
              status: 'failed',
              durationMs: out.durationMs,
              failure: {
                code: 'RESULT_INVALID',
                message: 'The engine returned a result that does not match the result contract.',
              },
            });
      } else {
        finished = finishRun(base, {
          status: out.error.code === 'CANCELLED' ? 'cancelled' : 'failed',
          durationMs: out.durationMs,
          failure: { code: out.error.code, message: out.error.message },
        });
      }
    } catch {
      finished = finishRun(base, {
        status: 'failed',
        failure: { code: 'ENGINE_INTERNAL', message: 'The run record could not be built.' },
      });
    }
    try {
      await saveRun(finished);
    } catch (e) {
      console.error('run could not be stored', e instanceof Error ? e.name : 'error');
    }
    await useRuns.getState().refresh(base.projectId);
    useRuns.getState().select(finished.record.status === 'complete' ? finished.runId : null);
    set({
      active: null,
      outcome: {
        runId: finished.runId,
        status: finished.record.status as Outcome['status'],
        ...(finished.failure ? { failure: finished.failure } : {}),
      },
    });
  },

  cancel() {
    const a = get().active;
    if (!a || a.cancelRequested) return;
    set({ active: { ...a, cancelRequested: true } });
    handle?.cancel();
  },

  clearOutcome: () => set({ outcome: null }),
}));
