/**
 * Indicator → column mapping suggestions (PLAN §2.2 step 4). Suggestions are only
 * suggestions: the user confirms them, and `applyMapping` is the explicit step that writes
 * `indicator.column`.
 *
 * Tiers, strongest first: exact name, case-insensitive name, normalized name (Unicode
 * compatibility-decomposed, lower-cased, everything but a–z/0–9 removed: "USEF_1" ↔ "usef1").
 * A tier is resolved for all indicators before the next one is tried, and a column claimed in
 * a stronger tier is no longer available. Within a tier, an indicator with several candidate
 * columns, or a column claimed by several indicators, is ambiguous and gets no suggestion —
 * a suggestion never maps two indicators to one column.
 */
import type { SemModel } from '@sem-lab/contracts';
import type { MappingSuggestion } from './types';

type Tier = Exclude<MappingSuggestion['match'], 'none'>;

export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const KEYS: Record<Tier, (s: string) => string> = {
  exact: (s) => s,
  'case-insensitive': (s) => s.toLowerCase(),
  normalized: normalizeName,
};
const TIERS: readonly Tier[] = ['exact', 'case-insensitive', 'normalized'];

export function suggestMapping(model: SemModel, columns: readonly string[]): MappingSuggestion[] {
  const result = new Map<string, MappingSuggestion>();
  const taken = new Set<string>();
  const ambiguous = new Set<string>();

  for (const tier of TIERS) {
    const key = KEYS[tier];
    const available = columns.filter((c) => !taken.has(c));
    const claims = new Map<string, string[]>(); // column → indicator ids
    const choice = new Map<string, string>(); // indicator id → column
    for (const ind of model.indicators) {
      if (result.has(ind.id) || ambiguous.has(ind.id)) continue;
      const wanted = key(ind.name);
      if (wanted === '') continue;
      const candidates = available.filter((c) => key(c) === wanted);
      if (candidates.length > 1) {
        ambiguous.add(ind.id);
      } else if (candidates.length === 1) {
        const col = candidates[0] as string;
        choice.set(ind.id, col);
        claims.set(col, [...(claims.get(col) ?? []), ind.id]);
      }
    }
    for (const [id, col] of choice) {
      if ((claims.get(col) ?? []).length > 1) {
        ambiguous.add(id);
        continue;
      }
      result.set(id, { indicatorId: id, column: col, match: tier });
      taken.add(col);
    }
  }

  return model.indicators.map(
    (ind) => result.get(ind.id) ?? { indicatorId: ind.id, column: null, match: 'none' },
  );
}

/** A new model whose indicators are bound to the suggested columns ('none' leaves them as they are). */
export function applyMapping(model: SemModel, suggestions: readonly MappingSuggestion[]): SemModel {
  const byId = new Map(
    suggestions
      .filter((s) => s.match !== 'none' && s.column !== null)
      .map((s) => [s.indicatorId, s.column]),
  );
  return {
    ...model,
    indicators: model.indicators.map((ind) => {
      const column = byId.get(ind.id);
      return column === undefined || column === null ? ind : { ...ind, column };
    }),
  };
}
