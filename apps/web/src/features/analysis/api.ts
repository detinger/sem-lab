/**
 * Client for the SEM Studio analysis API (apps/api; docs/architecture/engine-protocol.md).
 *
 * Privacy (PLAN §2.2): data leave the browser only through `submitJob`, which the UI calls
 * after an explicit "Run on server" confirmation. Only the analysis matrix is sent — the
 * model's indicator columns after the chosen missing-data handling — never the whole file,
 * never in a URL.
 */
import {
  type AnalysisConfiguration,
  NormalizedSemResult,
  type SemModel,
} from '@sem-studio/contracts';
import type { AnalysisData } from '@/domain/dataset/types';

export const API_BASE_URL: string | null = (() => {
  const v: string | undefined = import.meta.env.VITE_API_BASE_URL;
  const trimmed = v?.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : null;
})();

export type JobStatusValue =
  | 'queued'
  | 'validating'
  | 'estimating'
  | 'bootstrapping'
  | 'summarizing'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface JobStatus {
  id: string;
  status: JobStatusValue;
  stage: string | null;
  /** present only when the engine reported them — never interpolated */
  done: number | null;
  total: number | null;
  failed: number | null;
  inadmissible: number | null;
  warnings: Array<{ code: string; severity: string; message: string }>;
  error: { code: string; message: string; details?: unknown } | null;
  engine: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

/** One entry of `/api/health` `engines` (an array; apps/api/app/health.py). */
export interface EngineHealth {
  id: string;
  available: boolean;
  /** true when the API can run jobs with this engine (Python engines: export-only) */
  jobs?: boolean;
  version?: string | null;
  runtime?: string | null;
  reason?: string | null;
}

export interface Health {
  status: string;
  version: string;
  engines: EngineHealth[];
  limits: {
    maxCsvMb: number;
    maxRows: number;
    maxColumns: number;
    maxBootstrapReps: number;
    maxConcurrentJobs: number;
    jobTimeoutSeconds: number;
    dataRetentionHours: number;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const TERMINAL: ReadonlySet<JobStatusValue> = new Set(['complete', 'failed', 'cancelled']);

function requireBase(): string {
  if (!API_BASE_URL)
    throw new ApiError(
      0,
      'API_NOT_CONFIGURED',
      'No analysis service is configured for this build (VITE_API_BASE_URL is empty).',
    );
  return API_BASE_URL;
}

async function call<T>(
  path: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const base = requireBase(); // outside the try: "not configured" must not be reported as "unreachable"
  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, { ...init, credentials: 'omit' });
  } catch {
    throw new ApiError(0, 'NETWORK', 'The analysis service could not be reached.');
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? `HTTP_${res.status}`,
      body?.error?.message ?? `The service answered ${res.status}.`,
    );
  }
  return body as T;
}

/** CSV of the analysis matrix: RFC 4180, '.' decimals, empty field = missing (FIML only). */
export function analysisCsv(data: AnalysisData): string {
  const q = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [data.columns.map(q).join(',')];
  for (const row of data.rows) lines.push(row.map((v) => (v === null ? '' : String(v))).join(','));
  return `${lines.join('\n')}\n`;
}

export const api = {
  health: (f?: typeof fetch) => call<Health>('/api/health', undefined, f),

  async submitJob(
    model: SemModel,
    analysis: AnalysisConfiguration,
    data: AnalysisData,
    f?: typeof fetch,
  ): Promise<{ id: string }> {
    const form = new FormData();
    form.append('request', JSON.stringify({ model, analysis }));
    form.append('data', new Blob([analysisCsv(data)], { type: 'text/csv' }), 'data.csv');
    return call<{ id: string }>('/api/analysis/jobs', { method: 'POST', body: form }, f);
  },

  status: (id: string, f?: typeof fetch) =>
    call<JobStatus>(`/api/analysis/jobs/${encodeURIComponent(id)}`, undefined, f),
  cancel: (id: string, f?: typeof fetch) =>
    call<unknown>(`/api/analysis/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }, f),
  /** "Delete uploaded data and jobs" — removes the job and its files on the server. */
  remove: (id: string, f?: typeof fetch) =>
    call<void>(`/api/analysis/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }, f),

  /** The result is validated against the contract here too; an invalid result is an error, never shown. */
  async result(id: string, f?: typeof fetch): Promise<NormalizedSemResult> {
    const raw = await call<unknown>(
      `/api/analysis/jobs/${encodeURIComponent(id)}/result`,
      undefined,
      f,
    );
    const parsed = NormalizedSemResult.safeParse(raw);
    if (!parsed.success)
      throw new ApiError(
        0,
        'RESULT_INVALID',
        'The service returned a result that does not match the result contract.',
      );
    return parsed.data;
  },
};
