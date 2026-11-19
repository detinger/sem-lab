/**
 * Which capabilities an analysis request needs — the ONE definition shared by the web
 * validator and the API (apps/api/app/registry.py ports it; both are tested against
 * gating-vectors.json so they cannot drift apart).
 *
 * Rules (order of the returned list is stable):
 *  1. method: pls-sem → pls.estimation.classic; plsc → pls.estimation.plsc;
 *     cb-sem → cb.estimation.<estimator in lower case>
 *  2. PLS methods: pls.inner-weighting.<scheme> (default "path")
 *  3. PLS methods with any composite-formative block or explicit Mode B → pls.mode-b
 *  4. any higher-order declaration → pls.higher-order
 *  5. bootstrap enabled → resampling.bootstrap-<ci>
 *  6. missingData "fiml" → cb.missing.fiml
 *  7. ipma requested → ipma.construct
 */
import type { AnalysisConfiguration, SemModel } from '@sem-lab/contracts';

export function requiredCapabilities(model: SemModel, a: AnalysisConfiguration): string[] {
  const out: string[] = [];
  const pls = a.method === 'pls-sem' || a.method === 'plsc';
  if (a.method === 'pls-sem') out.push('pls.estimation.classic');
  else if (a.method === 'plsc') out.push('pls.estimation.plsc');
  else out.push(`cb.estimation.${a.estimator.toLowerCase()}`);
  if (pls) out.push(`pls.inner-weighting.${a.pls?.innerWeighting ?? 'path'}`);
  if (
    pls &&
    model.constructs.some(
      (c) => c.measurement === 'composite-formative' || c.plsWeightingMode === 'mode-b',
    )
  ) {
    out.push('pls.mode-b');
  }
  if (model.constructs.some((c) => c.higherOrder)) out.push('pls.higher-order');
  if (a.bootstrap?.enabled) out.push(`resampling.bootstrap-${a.bootstrap.ci}`);
  if (a.missingData === 'fiml') out.push('cb.missing.fiml');
  if (a.ipma) out.push('ipma.construct');
  return out;
}
