/**
 * Job runner (PLAN §2.6): submit → poll status every second → fetch the result → save the run.
 *
 * - Polling stops at a terminal state; request errors back off (2 s, 4 s … 10 s) and give up
 *   after MAX_POLL_ERRORS in a row, saying the job may still be running on the server.
 * - Progress is exactly what the status reports; no number is interpolated here.
 * - Nothing is written to a run before the service accepted the job; a finished run is
 *   written once and never changed (runs.ts).
 * - Data leave the browser only in `submitJob`, which callers reach after the remote-run
 *   confirmation (`confirmRemote`).
 */
import type { AnalysisConfiguration, SemModel } from '@sem-studio/contracts';
import { create } from 'zustand';
import type { AnalysisData } from '@/domain/dataset/types';
import { ApiError, type JobStatus, TERMINAL, api } from './api';
import {
  type StoredRun,
  clearServerJob,
  finishRun,
  getRun,
  isTerminalStatus,
  makeRun,
  saveRun,
  useRuns,
} from './runs';

export const POLL_INTERVAL_MS = 1000;
export const MAX_POLL_ERRORS = 10;

export interface ActiveJob {
  runId: string;
  jobId: string | null;
  /** 'submitting' until the service has accepted the job */
  phase: 'submitting' | 'running' | 'finishing';
  status: JobStatus | null;
  cancelRequested: boolean;
  /** a status request failed; the job may still be running */
  pollProblem: string | null;
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
  /** the last finished (or failed to start) job; the page reacts to it once */
  outcome: Outcome | null;
  /** the user confirmed "data leaves the browser" in this session */
  remoteConfirmed: boolean;
  /** polling interval; tests shorten it */
  intervalMs: number;
  confirmRemote: () => void;
  start: (input: StartInput, opts?: { intervalMs?: number }) => Promise<void>;
  resume: (run: StoredRun, opts?: { intervalMs?: number }) => void;
  cancel: () => Promise<void>;
  clearOutcome: () => void;
}

const errorOf = (e: unknown): { code: string; message: string } =>
  e instanceof ApiError
    ? { code: e.code, message: e.message }
    : { code: 'NETWORK', message: 'The analysis service could not be reached.' };

let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

export const useJobs = create<JobsState>()((set, get) => {
  async function finalize(run: StoredRun, status: JobStatus): Promise<void> {
    set((s) => (s.active ? { active: { ...s.active, phase: 'finishing' } } : s));
    let finished: StoredRun;
    try {
      if (status.status === 'complete') {
        const result = await api.result(status.id);
        finished = finishRun(run, { status: 'complete', result });
      } else if (status.status === 'cancelled') {
        finished = finishRun(run, {
          status: 'cancelled',
          failure: { code: 'CANCELLED', message: 'The job was cancelled.' },
        });
      } else {
        finished = finishRun(run, {
          status: 'failed',
          failure: status.error ?? { code: 'ENGINE_INTERNAL', message: 'The job failed.' },
        });
      }
    } catch (e) {
      finished = finishRun(run, { status: 'failed', failure: errorOf(e) });
    }
    try {
      await saveRun(finished);
    } catch (e) {
      console.error('run could not be stored', e instanceof Error ? e.name : 'error');
    }
    await useRuns.getState().refresh(run.projectId);
    useRuns.getState().select(finished.record.status === 'complete' ? finished.runId : null);
    set({
      active: null,
      outcome: {
        runId: finished.runId,
        status: finished.record.status as Outcome['status'],
        ...(finished.failure ? { failure: finished.failure } : {}),
      },
    });
  }

  function poll(run: StoredRun, jobId: string, intervalMs: number, mine: number): void {
    let errors = 0;
    const tick = async (): Promise<void> => {
      if (mine !== generation) return;
      let status: JobStatus;
      try {
        status = await api.status(jobId);
      } catch (e) {
        if (mine !== generation) return;
        errors++;
        const { code } = errorOf(e);
        // The job is gone on the server (deleted, expired): stop, do not loop on 404.
        if (code === 'NOT_FOUND') {
          void finalize(run, {
            id: jobId,
            status: 'failed',
            error: { code: 'ENGINE_INTERNAL', message: 'The job no longer exists on the service.' },
          } as JobStatus);
          return;
        }
        const problem =
          errors >= MAX_POLL_ERRORS
            ? 'The analysis service stopped answering. The job may still be running on the server; reload to look for it again.'
            : 'The analysis service did not answer; trying again.';
        set((s) => (s.active ? { active: { ...s.active, pollProblem: problem } } : s));
        if (errors >= MAX_POLL_ERRORS) return;
        timer = setTimeout(() => void tick(), Math.min(10_000, intervalMs * 2 ** errors));
        return;
      }
      if (mine !== generation) return;
      errors = 0;
      if (TERMINAL.has(status.status)) {
        await finalize(run, status);
        return;
      }
      set((s) => (s.active ? { active: { ...s.active, status, pollProblem: null } } : s));
      timer = setTimeout(() => void tick(), intervalMs);
    };
    timer = setTimeout(() => void tick(), 0);
  }

  return {
    active: null,
    outcome: null,
    remoteConfirmed: false,
    intervalMs: POLL_INTERVAL_MS,
    confirmRemote: () => set({ remoteConfirmed: true }),

    async start(input, opts) {
      if (get().active) return;
      const mine = ++generation;
      clearTimeout(timer);
      set({
        outcome: null,
        active: {
          runId: '',
          jobId: null,
          phase: 'submitting',
          status: null,
          cancelRequested: false,
          pollProblem: null,
        },
      });
      let jobId: string;
      try {
        jobId = (await api.submitJob(input.model, input.analysis, input.data)).id;
      } catch (e) {
        if (mine !== generation) return;
        set({ active: null, outcome: { runId: '', status: 'failed', failure: errorOf(e) } });
        return;
      }
      const run = makeRun({
        projectId: input.projectId,
        model: input.model,
        analysis: input.analysis,
        modelHash: input.modelHash,
        dataFingerprint: input.dataFingerprint,
        serverJobId: jobId,
      });
      try {
        await saveRun(run);
        await useRuns.getState().refresh(run.projectId);
      } catch {
        /* a run that cannot be stored locally still runs; the result is lost on reload */
      }
      set({
        active: {
          runId: run.runId,
          jobId,
          phase: 'running',
          status: null,
          cancelRequested: false,
          pollProblem: null,
        },
      });
      poll(run, jobId, opts?.intervalMs ?? get().intervalMs, mine);
    },

    resume(run, opts) {
      if (get().active || !run.serverJobId || isTerminalStatus(run.record.status)) return;
      const mine = ++generation;
      set({
        outcome: null,
        active: {
          runId: run.runId,
          jobId: run.serverJobId,
          phase: 'running',
          status: null,
          cancelRequested: false,
          pollProblem: null,
        },
      });
      poll(run, run.serverJobId, opts?.intervalMs ?? get().intervalMs, mine);
    },

    async cancel() {
      const a = get().active;
      if (!a?.jobId || a.cancelRequested) return;
      set({ active: { ...a, cancelRequested: true } });
      try {
        await api.cancel(a.jobId);
      } catch {
        set((s) =>
          s.active
            ? {
                active: {
                  ...s.active,
                  cancelRequested: false,
                  pollProblem: 'Cancel could not be sent; try again.',
                },
              }
            : s,
        );
      }
      // polling continues until the service reports the terminal state
    },

    clearOutcome: () => set({ outcome: null }),
  };
});

/** Stored runs that were left running (page reloaded mid-job): the Analysis page resumes polling. */
export async function findResumable(projectId: string): Promise<StoredRun | undefined> {
  const runs = useRuns.getState().runs.filter((r) => r.projectId === projectId);
  const open = runs.find((r) => !isTerminalStatus(r.record.status) && r.serverJobId);
  return open ? ((await getRun(open.runId)) ?? open) : undefined;
}

/** "Delete uploaded data and jobs" for one run: the service forgets the job, the record stays. */
export async function deleteServerJob(run: StoredRun): Promise<{ ok: boolean; message?: string }> {
  if (!run.serverJobId) return { ok: true };
  try {
    await api.remove(run.serverJobId);
  } catch (e) {
    const err = errorOf(e);
    if (err.code !== 'NOT_FOUND') return { ok: false, message: err.message };
  }
  await clearServerJob(run.runId);
  await useRuns.getState().refresh(run.projectId);
  return { ok: true };
}
