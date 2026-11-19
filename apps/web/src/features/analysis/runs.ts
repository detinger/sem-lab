/**
 * Analysis run records (PLAN §3.3), kept in this browser's IndexedDB.
 *
 * A run binds a result to the exact model, data and configuration it was computed from.
 * `record` (the contracts AnalysisRun) is immutable once its status is terminal.
 * Runs are computed in this browser by the SEM Lab engine (engine 'browser'); nothing is uploaded.
 * The record holds the model AS SUBMITTED, so a historical run still reads with the names it
 * was computed with, but never any row-level data.
 *
 * A run is STALE when the project's current model hash or data fingerprint differs from the
 * run's. Stale runs are shown as historical, never as current results.
 */
import {
  AnalysisRun,
  type AnalysisConfiguration,
  type NormalizedSemResult,
  type RunStatus,
  SCHEMA_VERSION,
  type SemModel,
  modelHash as hashModel,
} from '@sem-lab/contracts';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useModeler } from '@/features/modeler/store';
import { getDb } from '@/storage/projects';

export interface RunFailure {
  code: string;
  message: string;
}

export interface StoredRun {
  runId: string;
  projectId: string;
  createdAt: string;
  modelHash: string;
  dataFingerprint: string;
  /** measured wall-clock time of the run, milliseconds (absent on runs stored before it was measured) */
  durationMs?: number;
  /** immutable once terminal */
  record: AnalysisRun;
  /** the model as submitted (structure and names, no data) */
  model: SemModel;
  failure?: RunFailure;
}

export const isTerminalStatus = (s: RunStatus): boolean =>
  s === 'complete' || s === 'failed' || s === 'cancelled';

let counter = 0;
export const newRunId = (): string =>
  `run_${Date.now().toString(36)}_${(counter++).toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

export interface NewRunInput {
  projectId: string;
  model: SemModel;
  analysis: AnalysisConfiguration;
  modelHash: string;
  dataFingerprint: string;
  now?: string;
}

export function makeRun(input: NewRunInput): StoredRun {
  const createdAt = input.now ?? new Date().toISOString();
  const runId = newRunId();
  return {
    runId,
    projectId: input.projectId,
    createdAt,
    modelHash: input.modelHash,
    dataFingerprint: input.dataFingerprint,
    model: input.model,
    record: AnalysisRun.parse({
      runId,
      schemaVersion: SCHEMA_VERSION,
      modelHash: input.modelHash,
      dataFingerprint: input.dataFingerprint,
      method: input.analysis.method,
      engine: input.analysis.engine,
      packageVersions: {},
      options: input.analysis,
      status: 'running',
      createdAt,
      warnings: [],
    }),
  };
}

/** The terminal record for a job that finished. Pure; validated against the contract. */
export function finishRun(
  run: StoredRun,
  outcome:
    | { status: 'complete'; result: NormalizedSemResult; durationMs?: number }
    | { status: 'failed' | 'cancelled'; failure: RunFailure; durationMs?: number },
): StoredRun {
  if (isTerminalStatus(run.record.status))
    throw new Error('A finished run is immutable and cannot be changed.');
  if (outcome.status === 'complete') {
    return {
      ...run,
      ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
      record: AnalysisRun.parse({
        ...run.record,
        status: 'complete',
        packageVersions: outcome.result.provenance.packageVersions,
        warnings: outcome.result.warnings.map((w) => ({
          code: w.code,
          message: w.message,
          severity: w.severity,
        })),
        result: outcome.result,
      }),
    };
  }
  return {
    ...run,
    ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
    failure: outcome.failure,
    record: AnalysisRun.parse({ ...run.record, status: outcome.status }),
  };
}

// ---------------------------------------------------------------- storage

export async function saveRun(run: StoredRun): Promise<void> {
  const db = getDb();
  const existing = await db.runs.get(run.runId);
  if (existing && isTerminalStatus(existing.record.status)) {
    const same = JSON.stringify(existing.record) === JSON.stringify(run.record);
    if (!same) throw new Error('A finished run is immutable and cannot be changed.');
  }
  await db.runs.put(run);
}

export async function listRuns(projectId: string): Promise<StoredRun[]> {
  const rows = await getDb().runs.where('projectId').equals(projectId).toArray();
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRun(runId: string): Promise<StoredRun | undefined> {
  return getDb().runs.get(runId);
}

export async function deleteRunsOfProject(projectId: string): Promise<void> {
  await getDb().runs.where('projectId').equals(projectId).delete();
}

// ---------------------------------------------------------------- staleness

export type Staleness = 'current' | 'model' | 'data';

export interface CurrentIdentity {
  modelHash: string | null;
  dataFingerprint: string | null;
}

/** `modelHash: null` = not computed yet (treated as unchanged); `dataFingerprint: null` = no data linked. Model changes win over data changes in the wording; either makes the run historical. */
export function stalenessOf(
  run: Pick<StoredRun, 'modelHash' | 'dataFingerprint'>,
  now: CurrentIdentity,
): Staleness {
  if (now.modelHash !== null && now.modelHash !== run.modelHash) return 'model';
  // No data linked to the project now (null) also means the data are not the run's data.
  if (now.dataFingerprint !== run.dataFingerprint) return 'data';
  return 'current';
}

export const STALE_LABEL: Record<Exclude<Staleness, 'current'>, string> = {
  model: 'historical (model changed since this run)',
  data: 'historical (data changed since this run)',
};

// ---------------------------------------------------------------- store + hooks

interface RunsState {
  projectId: string | null;
  runs: StoredRun[];
  /** run shown on the Results page; null = latest current */
  selectedRunId: string | null;
  refresh: (projectId: string) => Promise<void>;
  select: (runId: string | null) => void;
}

export const useRuns = create<RunsState>()((set, get) => ({
  projectId: null,
  runs: [],
  selectedRunId: null,
  async refresh(projectId) {
    try {
      const runs = await listRuns(projectId);
      set({ projectId, runs });
    } catch {
      if (get().projectId !== projectId) set({ projectId, runs: [] });
    }
  },
  select: (runId) => set({ selectedRunId: runId }),
}));

/** Hash of the open model, computed asynchronously (SHA-256 via Web Crypto). */
export function useModelHash(): string | null {
  const model = useModeler((s) => s.model);
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    hashModel(model).then(
      (h) => live && setHash(h),
      () => live && setHash(null),
    );
    return () => {
      live = false;
    };
  }, [model, setHash]);
  return hash;
}

export interface RunView extends StoredRun {
  staleness: Staleness;
}

export interface ProjectRuns {
  runs: RunView[];
  /** newest complete run whose model and data match the open project */
  current: RunView | null;
  identityReady: boolean;
}

/** Loads the open project's runs and classifies each as current or historical. */
export function useProjectRuns(): ProjectRuns {
  const projectId = useModeler((s) => s.projectId);
  const fingerprint = useModeler((s) => s.datasetRef?.fingerprint ?? null);
  const hash = useModelHash();
  const runs = useRuns((s) => s.runs);
  const loadedFor = useRuns((s) => s.projectId);
  useEffect(() => {
    void useRuns.getState().refresh(projectId);
  }, [projectId]);
  return useMemo(() => {
    const mine = loadedFor === projectId ? runs : [];
    const views = mine.map((r) => ({
      ...r,
      staleness: stalenessOf(r, { modelHash: hash, dataFingerprint: fingerprint }),
    }));
    const current =
      hash === null
        ? null
        : (views.find((r) => r.staleness === 'current' && r.record.status === 'complete') ?? null);
    return { runs: views, current, identityReady: hash !== null };
  }, [runs, loadedFor, projectId, hash, fingerprint]);
}
