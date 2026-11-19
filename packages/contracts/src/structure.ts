import type { Severity } from './common.ts';
import type { SemModel } from './model.ts';

/**
 * Method-independent structural invariants of a SemModel (contracts.md §2).
 *
 * The Zod schema checks shape; this checks referential integrity. Method- and
 * engine-dependent rules (cycles, identification, cross-loadings, single-indicator
 * handling, unmapped columns) belong to the analysis validator, not here.
 */

export type StructureIssueCode =
  | 'DUPLICATE_ID'
  | 'DUPLICATE_CONSTRUCT_NAME'
  | 'DUPLICATE_INDICATOR_NAME'
  | 'UNKNOWN_BLOCK_INDICATOR'
  | 'DUPLICATE_BLOCK_INDICATOR'
  | 'UNKNOWN_ENDPOINT'
  | 'STRUCTURAL_ENDPOINT_NOT_CONSTRUCT'
  | 'COVARIANCE_ENDPOINT_MISMATCH'
  | 'SELF_LOOP'
  | 'DUPLICATE_STRUCTURAL_PATH'
  | 'DUPLICATE_COVARIANCE'
  | 'DUPLICATE_PARAMETER_LABEL'
  | 'UNKNOWN_HIGHER_ORDER_CHILD';

export interface StructureIssue {
  code: StructureIssueCode;
  severity: Extract<Severity, 'error'>;
  message: string;
  elementIds: string[];
}

export function validateModelStructure(model: SemModel): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const add = (code: StructureIssueCode, message: string, elementIds: string[]): void => {
    issues.push({ code, severity: 'error', message, elementIds });
  };

  const constructIds = new Set(model.constructs.map((c) => c.id));
  const indicatorIds = new Set(model.indicators.map((i) => i.id));

  // Ids are unique across ALL element kinds, because diagram nodes, edges and result keys share one namespace.
  const seen = new Map<string, number>();
  for (const id of [
    ...model.constructs.map((c) => c.id),
    ...model.indicators.map((i) => i.id),
    ...model.relationships.map((r) => r.id),
  ]) {
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [id, n] of seen) {
    if (n > 1) add('DUPLICATE_ID', `The id "${id}" is used by ${n} elements.`, [id]);
  }

  duplicates(model.constructs, (c) => c.name).forEach((ids, name) =>
    add('DUPLICATE_CONSTRUCT_NAME', `Construct name "${name}" is used more than once.`, ids),
  );
  duplicates(model.indicators, (i) => i.name).forEach((ids, name) =>
    add('DUPLICATE_INDICATOR_NAME', `Indicator name "${name}" is used more than once.`, ids),
  );

  for (const c of model.constructs) {
    const inBlock = new Set<string>();
    for (const iid of c.indicatorIds) {
      if (!indicatorIds.has(iid)) {
        add(
          'UNKNOWN_BLOCK_INDICATOR',
          `Construct "${c.name}" lists an indicator id "${iid}" that does not exist.`,
          [c.id],
        );
      }
      if (inBlock.has(iid)) {
        add('DUPLICATE_BLOCK_INDICATOR', `Construct "${c.name}" lists indicator "${iid}" twice.`, [
          c.id,
          iid,
        ]);
      }
      inBlock.add(iid);
    }
    for (const child of c.higherOrder?.childConstructIds ?? []) {
      if (!constructIds.has(child) || child === c.id) {
        add(
          'UNKNOWN_HIGHER_ORDER_CHILD',
          `Construct "${c.name}" has an invalid higher-order child "${child}".`,
          [c.id],
        );
      }
    }
  }

  const structuralPairs = new Set<string>();
  const covariancePairs = new Set<string>();
  const labels = new Map<string, string[]>();
  for (const r of model.relationships) {
    if (r.parameterLabel)
      labels.set(r.parameterLabel, [...(labels.get(r.parameterLabel) ?? []), r.id]);

    const known = (id: string): boolean => constructIds.has(id) || indicatorIds.has(id);
    if (!known(r.sourceId) || !known(r.targetId)) {
      add('UNKNOWN_ENDPOINT', `Relationship "${r.id}" connects an element that does not exist.`, [
        r.id,
      ]);
      continue;
    }
    if (r.sourceId === r.targetId) {
      add('SELF_LOOP', `Relationship "${r.id}" connects an element to itself.`, [r.id]);
      continue;
    }
    if (r.kind === 'structural') {
      if (!constructIds.has(r.sourceId) || !constructIds.has(r.targetId)) {
        add(
          'STRUCTURAL_ENDPOINT_NOT_CONSTRUCT',
          `Structural path "${r.id}" must connect two constructs.`,
          [r.id],
        );
        continue;
      }
      const key = `${r.sourceId}\u0000${r.targetId}`;
      if (structuralPairs.has(key))
        add('DUPLICATE_STRUCTURAL_PATH', `Structural path "${r.id}" duplicates another.`, [r.id]);
      structuralPairs.add(key);
    } else {
      const bothConstructs = constructIds.has(r.sourceId) && constructIds.has(r.targetId);
      const bothIndicators = indicatorIds.has(r.sourceId) && indicatorIds.has(r.targetId);
      if (!bothConstructs && !bothIndicators) {
        add(
          'COVARIANCE_ENDPOINT_MISMATCH',
          `Covariance "${r.id}" must connect two constructs or two indicators (residual covariance).`,
          [r.id],
        );
        continue;
      }
      const key = [r.sourceId, r.targetId].sort().join('\u0000');
      if (covariancePairs.has(key))
        add('DUPLICATE_COVARIANCE', `Covariance "${r.id}" duplicates another.`, [r.id]);
      covariancePairs.add(key);
    }
  }
  for (const [label, ids] of labels) {
    if (ids.length > 1)
      add('DUPLICATE_PARAMETER_LABEL', `Parameter label "${label}" is used more than once.`, ids);
  }
  return issues;
}

function duplicates<T extends { id: string }>(
  items: readonly T[],
  key: (t: T) => string,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const it of items) groups.set(key(it), [...(groups.get(key(it)) ?? []), it.id]);
  return new Map([...groups].filter(([, ids]) => ids.length > 1));
}
