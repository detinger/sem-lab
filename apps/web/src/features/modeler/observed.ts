import type { SemModel } from '@sem-lab/contracts';

/**
 * Constructs drawn as observed variables (one rectangle, path-analysis notation): those listed in
 * `settings.observedConstructIds` that have exactly one existing indicator. Display only — the
 * model and every estimator see an ordinary single-indicator construct.
 */
export function observedConstructs(
  model: SemModel,
  settings: { readonly observedConstructIds?: readonly string[] | undefined },
): Set<string> {
  const listed = new Set(settings.observedConstructIds ?? []);
  const out = new Set<string>();
  if (listed.size === 0) return out;
  const indicatorIds = new Set(model.indicators.map((i) => i.id));
  for (const c of model.constructs)
    if (listed.has(c.id) && singleIndicator(c.indicatorIds, indicatorIds)) out.add(c.id);
  return out;
}

/** Constructs that could be drawn as observed variables (exactly one existing indicator). */
export function singleIndicatorConstructs(model: SemModel): string[] {
  const indicatorIds = new Set(model.indicators.map((i) => i.id));
  return model.constructs
    .filter((c) => singleIndicator(c.indicatorIds, indicatorIds))
    .map((c) => c.id);
}

const singleIndicator = (ids: readonly string[], existing: ReadonlySet<string>): boolean =>
  ids.filter((id) => existing.has(id)).length === 1;
