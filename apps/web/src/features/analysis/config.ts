/**
 * Analysis configuration state and its translation to the contract's AnalysisConfiguration.
 * Gating comes from the capability registry (isOffered / unavailableReason), never from
 * hard-coded lists; the only fixed text here is the CB-SEM card (PLAN Phase 3 scope).
 */
import { AnalysisConfiguration, type EngineId, type SemMethod } from '@sem-studio/contracts';
import { METHOD_CAPABILITY, isOffered, unavailableReason } from '@sem-studio/method-registry';
import { create } from 'zustand';
import type { EngineHealth, Health } from './api';

export const ENGINE: EngineId = 'r-csem';
export const BOOTSTRAP_PRESETS = [500, 2000, 5000, 10000] as const;
export const DEFAULT_MAX_ITERATIONS = 300;
export const DEFAULT_TOLERANCE = 1e-7;
export const CB_SEM_REASON =
  'CB-SEM estimation arrives in a later release (lavaan engine verified, adapter pending).';

export interface ConfigState {
  method: 'pls-sem' | 'plsc';
  innerWeighting: 'path' | 'centroid' | 'factorial';
  /** text fields keep what the user typed; parsing happens in toConfiguration */
  maxIterations: string;
  tolerance: string;
  bootstrap: boolean;
  repetitions: string;
  seed: string;
  ci: 'percentile' | 'bca';
  confidenceLevel: '0.90' | '0.95' | '0.99';
  sides: 'two-sided' | 'one-sided';
  /** IPMA target construct id; '' = no IPMA */
  ipmaTarget: string;
}

export const randomSeed = (): number => Math.floor(Math.random() * 2_147_483_647);

export function defaultConfig(seed: number = randomSeed()): ConfigState {
  return {
    method: 'pls-sem',
    innerWeighting: 'path',
    maxIterations: String(DEFAULT_MAX_ITERATIONS),
    tolerance: String(DEFAULT_TOLERANCE),
    bootstrap: true,
    repetitions: '2000',
    seed: String(seed),
    ci: 'percentile',
    confidenceLevel: '0.95',
    sides: 'two-sided',
    ipmaTarget: '',
  };
}

export const useAnalysisConfig = create<{
  config: ConfigState;
  set: (patch: Partial<ConfigState>) => void;
  reset: () => void;
}>()((set) => ({
  config: defaultConfig(),
  set: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
  reset: () => set({ config: defaultConfig() }),
}));

export interface FieldProblems {
  maxIterations?: string;
  tolerance?: string;
  repetitions?: string;
  seed?: string;
}

const INT = /^\d+$/;

/** Parse the text fields. Returns the configuration when valid, otherwise per-field problems. */
export function toConfiguration(
  c: ConfigState,
  maxBootstrap = 100_000,
): { ok: true; analysis: AnalysisConfiguration } | { ok: false; problems: FieldProblems } {
  const problems: FieldProblems = {};
  const maxIt = INT.test(c.maxIterations.trim()) ? Number(c.maxIterations) : NaN;
  if (!(maxIt >= 1 && maxIt <= 100_000))
    problems.maxIterations = 'Enter a whole number from 1 to 100,000.';
  const tol = Number(c.tolerance);
  if (!(tol > 0 && tol <= 0.01))
    problems.tolerance = 'Enter a number above 0 and at most 0.01 (e.g. 1e-7).';
  let reps = NaN;
  let seed = NaN;
  if (c.bootstrap) {
    reps = INT.test(c.repetitions.trim()) ? Number(c.repetitions) : NaN;
    if (!(reps >= 1 && reps <= maxBootstrap))
      problems.repetitions = `Enter a whole number from 1 to ${maxBootstrap.toLocaleString('en')}.`;
    seed = INT.test(c.seed.trim()) ? Number(c.seed) : NaN;
    if (!(seed >= 0 && seed <= 2_147_483_647))
      problems.seed = 'A seed is required: a whole number from 0 to 2,147,483,647.';
  }
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  const candidate = {
    method: c.method,
    engine: ENGINE,
    estimator: 'pls-pm',
    missingData: 'listwise' as const,
    ...(c.ipmaTarget && c.method === 'pls-sem' && isOffered('ipma.construct', ENGINE)
      ? { ipma: { targetConstructId: c.ipmaTarget } }
      : {}),
    pls: { innerWeighting: c.innerWeighting, maxIterations: maxIt, tolerance: tol },
    ...(c.bootstrap
      ? {
          seed,
          bootstrap: {
            enabled: true,
            repetitions: reps,
            ci: c.ci,
            confidenceLevel: Number(c.confidenceLevel),
            sides: c.sides,
          },
        }
      : {}),
  };
  const parsed = AnalysisConfiguration.safeParse(candidate);
  return parsed.success
    ? { ok: true, analysis: parsed.data }
    : {
        ok: false,
        problems: { seed: parsed.error.issues[0]?.message ?? 'Invalid configuration.' },
      };
}

export interface Gate {
  offered: boolean;
  reason?: string;
}

const gate = (id: string): Gate => {
  const reason = unavailableReason(id, ENGINE);
  return isOffered(id, ENGINE)
    ? { offered: true }
    : { offered: false, ...(reason ? { reason } : {}) };
};

export const methodGate = (m: SemMethod): Gate =>
  m === 'cb-sem' ? { offered: false, reason: CB_SEM_REASON } : gate(METHOD_CAPABILITY[m]);
export const weightingGate = (w: ConfigState['innerWeighting']): Gate =>
  gate(`pls.inner-weighting.${w}`);
export const ipmaGate = (): Gate => gate('ipma.construct');
export const IPMA_PLSC_TEXT = 'IPMA uses a classic PLS fit';
export const ciGate = (ci: ConfigState['ci']): Gate =>
  gate(ci === 'percentile' ? 'resampling.bootstrap-percentile' : 'resampling.bootstrap-bca');

export const SIDES_RATIONALE =
  'Two-sided is the default: it makes no assumption about the sign of an effect. Choose one-sided only when theory fixed the direction before seeing the data; the one-sided interval then has one bound only.';

/** Seconds-level rough resource note from the engine's measured speed (docs/estimators/pls-csem.md §4). */
export function durationNote(reps: number): string {
  const seconds = Math.max(1, Math.round((reps / 100) * 0.75));
  return `Measured on a small model (3 constructs, 11 indicators, n = 500): about 0.75 s per 100 draws, so roughly ${seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`} here. Larger models and slower servers take longer.`;
}

/**
 * The service reports `engines` as a list of `{id, available, version, reason}`; api.ts types it as
 * a record. Accept both so an engine's availability is always read from the real payload.
 */
export function engineHealth(health: Health, id: string): EngineHealth | undefined {
  return health.engines.find((x) => x.id === id);
}
