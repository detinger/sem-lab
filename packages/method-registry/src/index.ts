import { EngineId, type SemMethod } from '@sem-lab/contracts';
import { z } from 'zod';
import registryJson from '../registry.json' with { type: 'json' };

/**
 * Capability registry (docs/architecture/contracts.md §7).
 *
 * `status` is what the APPLICATION offers; `verification` is the strength of the evidence.
 * Rules enforced by tests/registry.test.ts:
 *  - `supported` requires `verification: "reference-tested"` and ≥1 evidence path;
 *  - `beta` requires at least `engine-verified`;
 *  - every evidence path exists in the repository;
 *  - `unsupported` requires a `reason`;
 *  - every reference key exists in the citations list.
 */

export const CapabilityStatus = z.enum(['supported', 'beta', 'planned', 'unsupported']);
export type CapabilityStatus = z.infer<typeof CapabilityStatus>;

export const Verification = z.enum(['reference-tested', 'engine-verified', 'smoke-only', 'none']);
export type Verification = z.infer<typeof Verification>;

export const CapabilityFamily = z.enum([
  'pls-sem',
  'cb-sem',
  'resampling',
  'assessment',
  'effects',
  'prediction',
  'ipma',
  'groups',
  'data',
  'export',
]);

export const EngineCapability = z.strictObject({
  status: CapabilityStatus,
  verification: Verification,
  evidence: z.array(z.string().min(1)).default([]),
  /** Exact engine call/argument that implements it, e.g. `csem(.PLS_weight_scheme_inner = "centroid")`. */
  implementation: z.string().optional(),
  notes: z.string().optional(),
  reason: z.string().optional(),
});
export type EngineCapability = z.infer<typeof EngineCapability>;

export const Capability = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  family: CapabilityFamily,
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(['P1', 'P2', 'P3']),
  references: z.array(z.string()).default([]),
  engines: z.partialRecord(EngineId, EngineCapability),
});
export type Capability = z.infer<typeof Capability>;

export const EngineInfo = z.strictObject({
  id: EngineId,
  language: z.enum(['TypeScript', 'R', 'Python']),
  package: z.string(),
  version: z.string(),
  license: z.string(),
  notes: z.string().optional(),
});

export const Citation = z.strictObject({
  key: z.string(),
  text: z.string(),
  doi: z.string().optional(),
  url: z.string().optional(),
});

export const Registry = z.strictObject({
  schemaVersion: z.literal(1),
  updated: z.string(),
  engines: z.array(EngineInfo),
  citations: z.array(Citation),
  capabilities: z.array(Capability),
});
export type Registry = z.infer<typeof Registry>;

export const registry: Registry = Registry.parse(registryJson);

const OFFERED: ReadonlySet<CapabilityStatus> = new Set(['supported', 'beta']);

export function capability(id: string): Capability | undefined {
  return registry.capabilities.find((c) => c.id === id);
}

/** Is a capability offered for this engine? Unknown ids and unlisted engines are NOT offered. */
export function isOffered(id: string, engine: EngineId): boolean {
  const e = capability(id)?.engines[engine];
  return e !== undefined && OFFERED.has(e.status);
}

/** The text to show next to a disabled control. */
export function unavailableReason(id: string, engine: EngineId): string | undefined {
  const c = capability(id);
  if (!c) return `Unknown capability "${id}".`;
  const e = c.engines[engine];
  if (!e) return `${c.title} is not available for this engine.`;
  if (OFFERED.has(e.status)) return undefined;
  return (
    e.reason ??
    (e.status === 'planned'
      ? `${c.title} is planned but not yet verified for this engine.`
      : `${c.title} is not supported for this engine.`)
  );
}

/** Method → capability id that gates running that method at all. */
export const METHOD_CAPABILITY: Readonly<Record<SemMethod, string>> = {
  'pls-sem': 'pls.estimation.classic',
  plsc: 'pls.estimation.plsc',
  'cb-sem': 'cb.estimation.ml',
};

export { requiredCapabilities } from './gating';
