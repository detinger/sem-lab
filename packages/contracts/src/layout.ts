import { z } from 'zod';
import { FiniteNumber, Id } from './common.ts';

/** Visual layout. Never read by an estimator. See docs/architecture/contracts.md §3. */

export const LayoutDirection = z.enum(['LR', 'RL', 'TB', 'BT']);
export type LayoutDirection = z.infer<typeof LayoutDirection>;

export const NodePosition = z.strictObject({
  x: FiniteNumber,
  y: FiniteNumber,
  pinned: z.boolean().optional(),
});
export type NodePosition = z.infer<typeof NodePosition>;

export const Annotation = z.strictObject({
  id: Id,
  text: z.string().max(4000),
  x: FiniteNumber,
  y: FiniteNumber,
  width: FiniteNumber.positive().optional(),
});
export type Annotation = z.infer<typeof Annotation>;

export const LayoutSettings = z.strictObject({
  direction: LayoutDirection,
  gridSize: z.number().int().min(4).max(64),
  snapToGrid: z.boolean(),
  gridVisibility: z.enum(['dots', 'faint', 'hidden']),
  constructShape: z.enum(['ellipse', 'rounded']),
  indicatorDensity: z.enum(['default', 'dense']),
  collapsedConstructIds: z.array(Id),
  /**
   * Single-indicator constructs drawn as one rectangle (an observed variable, as in path
   * analysis) instead of an oval plus its indicator box. Display only; ignored for constructs
   * that do not have exactly one indicator.
   */
  observedConstructIds: z.array(Id).optional(),
});
export type LayoutSettings = z.infer<typeof LayoutSettings>;

export const SemLayout = z.strictObject({
  nodes: z.record(Id, NodePosition),
  edgeLabels: z
    .record(z.string().min(1), z.strictObject({ dx: FiniteNumber, dy: FiniteNumber }))
    .optional(),
  annotations: z.array(Annotation).optional(),
  settings: LayoutSettings,
});
export type SemLayout = z.infer<typeof SemLayout>;

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  direction: 'LR',
  gridSize: 16,
  snapToGrid: true,
  gridVisibility: 'dots',
  constructShape: 'ellipse',
  indicatorDensity: 'default',
  collapsedConstructIds: [],
};
