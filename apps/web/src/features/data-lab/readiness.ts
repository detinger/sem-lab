import type { SemMethod, SemModel } from '@sem-lab/contracts';
import { useMemo } from 'react';
import { analysisIndicators } from '@/domain/dataset/analysis-data';
import { missingness } from '@/domain/dataset/stats';
import type { ColumnProfile, Dataset } from '@/domain/dataset/types';
import {
  type DataSummary,
  type ValidationIssue,
  hasBlockingIssues,
  validate,
} from '@/domain/validation/validate';
import { useModeler } from '@/features/modeler/store';
import { useDataLab } from './store';

/** Unique dataset columns the model's indicators are bound to (existing columns only). */
export function mappedColumns(model: SemModel, dataset: Pick<Dataset, 'columns'> | null): string[] {
  if (!dataset) return [];
  const have = new Set(dataset.columns.map((c) => c.name));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of analysisIndicators(model)) {
    if (i.column !== null && have.has(i.column) && !seen.has(i.column)) {
      seen.add(i.column);
      out.push(i.column);
    }
  }
  return out;
}

export function dataSummary(
  model: SemModel,
  dataset: Dataset,
  profiles: ColumnProfile[],
): DataSummary {
  const cols = mappedColumns(model, dataset);
  return {
    rowCount: dataset.rowIndex.length,
    columns: profiles,
    ...(cols.length > 0 ? { completeRows: missingness(dataset, cols).completeRows } : {}),
  };
}

export interface Readiness {
  issues: ValidationIssue[];
  blocked: boolean;
  counts: { error: number; warning: number; recommendation: number; info: number };
  hasData: boolean;
}

export function summarize(issues: readonly ValidationIssue[]): Readiness['counts'] {
  const counts = { error: 0, warning: 0, recommendation: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return counts;
}

/** Validator output for the open model (and the loaded data, when there is any). */
export function useReadiness(method: SemMethod | undefined): Readiness {
  const model = useModeler((s) => s.model);
  const dataset = useDataLab((s) => s.dataset);
  const profiles = useDataLab((s) => s.profiles);
  return useMemo(() => {
    const issues = validate({
      model,
      ...(method ? { method } : {}),
      ...(dataset ? { data: dataSummary(model, dataset, profiles) } : {}),
    });
    return {
      issues,
      blocked: hasBlockingIssues(issues),
      counts: summarize(issues),
      hasData: dataset !== null,
    };
  }, [model, method, dataset, profiles]);
}
