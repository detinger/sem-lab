import type { SemModel } from '@sem-studio/contracts';
import { buildSpec, sampleMoments } from './spec.ts';

/**
 * Parameter count and degrees of freedom exactly as the CB engine (and lavaan `sem()`) will
 * use them, or null when the model cannot be built for CB-SEM.
 */
export function cbParameterCount(
  model: SemModel,
  identification: 'marker' | 'std-lv' = 'marker',
  meanStructure = false,
): { moments: number; parameters: number; df: number } | null {
  const b = buildSpec(model, identification, meanStructure);
  if (!b.ok) return null;
  const moments = sampleMoments(b.spec.p, meanStructure);
  return { moments, parameters: b.spec.npar, df: moments - b.spec.npar };
}
