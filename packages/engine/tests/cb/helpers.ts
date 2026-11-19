import { readFileSync } from 'node:fs';
import type { AnalysisConfiguration, NormalizedSemResult, SemModel } from '@sem-studio/contracts';
import type { CbDataInput } from '../../src/cb/index.ts';

const FIXTURES = new URL('../../../fixtures/', import.meta.url);

export function fixturePath(rel: string): URL {
  return new URL(rel, FIXTURES);
}

export function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(fixturePath(rel), 'utf8')) as T;
}

export function loadModel(caseId: string): SemModel {
  return readJson<SemModel>(`synthetic/${caseId}/model.json`);
}

/** Minimal CSV reader for the synthetic fixtures (comma, header, empty = missing, no quoting). */
export function loadData(caseId: string): CbDataInput {
  const text = readFileSync(fixturePath(`synthetic/${caseId}/data.csv`), 'utf8');
  const lines = text.split('\n').filter((l) => l.length > 0);
  const columns = lines[0]!.split(',');
  const rows = lines.slice(1).map((l) => l.split(',').map((v) => (v === '' ? null : Number(v))));
  return { columns, rows, nRows: rows.length, nDropped: 0 };
}

export type Variant =
  'ml-marker' | 'ml-stdlv' | 'mlr-marker' | 'ml-listwise' | 'ml-fiml' | 'mlr-fiml';

export function analysisFor(variant: Variant): AnalysisConfiguration {
  const estimator = variant.startsWith('mlr') ? 'MLR' : 'ML';
  const fiml = variant.endsWith('fiml');
  return {
    method: 'cb-sem',
    engine: 'browser',
    estimator,
    missingData: fiml ? 'fiml' : 'listwise',
    cb: { identification: variant === 'ml-stdlv' ? 'std-lv' : 'marker', meanStructure: fiml },
  };
}

export interface RefParam {
  lhs: string;
  op: string;
  rhs: string;
  est: number;
  se: number;
  z: number | null;
  pvalue: number | null;
  std_all: number | null;
}

export interface RefFile {
  case: string;
  variant: Variant;
  n_used: number;
  n_rows: number;
  converged: boolean;
  post_check: boolean;
  warnings: string[];
  parameters: RefParam[];
}

/** Candidate result keys for a lavaan parameter-table row (ids already substituted). */
export function keysFor(r: RefParam): string[] {
  switch (r.op) {
    case '=~':
      return [`loading:${r.lhs}:${r.rhs}`];
    case '~':
      return [`path:${r.rhs}->${r.lhs}`];
    case '~1':
      return [`intercept:${r.lhs}`];
    case '~~':
      return r.lhs === r.rhs
        ? [`variance:${r.lhs}`, `residual-variance:${r.lhs}`]
        : [`covariance:${r.lhs}~~${r.rhs}`, `covariance:${r.rhs}~~${r.lhs}`];
    default:
      return [];
  }
}

export function findParam(
  result: NormalizedSemResult,
  r: RefParam,
  scale: 'standardized' | 'unstandardized',
): NormalizedSemResult['parameters'][number] | undefined {
  const keys = keysFor(r);
  return result.parameters.find((p) => p.scale === scale && keys.includes(p.key));
}

export function fitValue(
  result: NormalizedSemResult,
  name: string,
  variant?: 'standard' | 'scaled' | 'robust',
): NormalizedSemResult['fit'][number] | undefined {
  return result.fit.find(
    (f) => f.name === name && (variant === undefined || (f.variant ?? 'standard') === variant),
  );
}
