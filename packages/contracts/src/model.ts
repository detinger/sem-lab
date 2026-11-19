import { z } from 'zod';
import { FiniteNumber, Id, Name } from './common.ts';

/**
 * Scientific model. See docs/architecture/contracts.md §2.
 *
 * Block membership lives ONLY in `construct.indicatorIds`; measurement arrows are derived
 * (see `measurementEdges`). There is deliberately no 'measurement' relationship kind.
 */

export const MeasurementKind = z.enum(['reflective', 'composite-formative']);
export type MeasurementKind = z.infer<typeof MeasurementKind>;

export const IndicatorLevel = z.enum(['continuous', 'ordinal', 'binary']);
export type IndicatorLevel = z.infer<typeof IndicatorLevel>;

export const ScaleEndpoints = z
  .strictObject({ min: FiniteNumber, max: FiniteNumber })
  .refine((s) => s.min < s.max, { message: 'scale.min must be smaller than scale.max' });
export type ScaleEndpoints = z.infer<typeof ScaleEndpoints>;

export const SemConstruct = z.strictObject({
  id: Id,
  name: Name,
  label: z.string().max(500).optional(),
  measurement: MeasurementKind,
  /** Ordered. For CB-SEM marker identification the first indicator is the marker. */
  indicatorIds: z.array(Id),
  /** Optional override of the PLS weighting mode; default derives from `measurement`. */
  plsWeightingMode: z.enum(['mode-a', 'mode-b']).optional(),
  /** Reserved. Gated by the capability registry; no engine supports it in schema v1. */
  higherOrder: z
    .strictObject({
      approach: z.enum(['repeated-indicators', 'two-stage']),
      childConstructIds: z.array(Id).min(1),
    })
    .optional(),
});
export type SemConstruct = z.infer<typeof SemConstruct>;

export const SemIndicator = z.strictObject({
  id: Id,
  name: Name,
  label: z.string().max(1000).optional(),
  /** Bound dataset column name; null = not yet mapped. */
  column: z.string().min(1).max(500).nullable(),
  /** ORIGINAL permissible endpoints (not observed extrema). Required for IPMA and reverse scoring. */
  scale: ScaleEndpoints.optional(),
  reverseScored: z.boolean().optional(),
  level: IndicatorLevel.optional(),
});
export type SemIndicator = z.infer<typeof SemIndicator>;

const relationshipBase = {
  id: Id,
  sourceId: Id,
  targetId: Id,
  parameterLabel: z
    .string()
    .regex(
      /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
      'parameter labels must be identifiers (letter, then letters/digits/_)',
    )
    .optional(),
  fixedValue: FiniteNumber.optional(),
};

export const StructuralRelationship = z.strictObject({
  ...relationshipBase,
  kind: z.literal('structural'),
  hypothesis: z.string().max(40).optional(),
});

export const CovarianceRelationship = z.strictObject({
  ...relationshipBase,
  kind: z.literal('covariance'),
});

export const SemRelationship = z.discriminatedUnion('kind', [
  StructuralRelationship,
  CovarianceRelationship,
]);
export type SemRelationship = z.infer<typeof SemRelationship>;
export type SemRelationshipKind = SemRelationship['kind'];

export const SemModel = z.strictObject({
  constructs: z.array(SemConstruct),
  indicators: z.array(SemIndicator),
  relationships: z.array(SemRelationship),
});
export type SemModel = z.infer<typeof SemModel>;

/** A derived measurement arrow, as drawn in the diagram. */
export interface MeasurementEdge {
  /** Deterministic id `meas:<constructId>:<indicatorId>`. */
  id: string;
  constructId: string;
  indicatorId: string;
  /** Visual and semantic direction: reflective = construct → indicator. */
  direction: 'construct-to-indicator' | 'indicator-to-construct';
}

export function measurementEdgeId(constructId: string, indicatorId: string): string {
  return `meas:${constructId}:${indicatorId}`;
}

/** Derive measurement arrows from block membership. Order follows constructs, then indicatorIds. */
export function measurementEdges(model: SemModel): MeasurementEdge[] {
  return model.constructs.flatMap((c) =>
    c.indicatorIds.map((indicatorId) => ({
      id: measurementEdgeId(c.id, indicatorId),
      constructId: c.id,
      indicatorId,
      direction:
        c.measurement === 'reflective' ? 'construct-to-indicator' : 'indicator-to-construct',
    })),
  );
}
