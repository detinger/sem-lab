import { z } from 'zod';
import { FiniteNumber, IsoDateTime, Sha256Hex } from './common.ts';

/**
 * Dataset reference and column schema. Contains NO row-level values — this is what a
 * project file stores by default and what may appear in logs.
 */

export const ColumnSchema = z.strictObject({
  name: z.string().min(1).max(500),
  type: z.enum(['numeric', 'text', 'empty']),
  nMissing: z.number().int().min(0),
  nUnique: z.number().int().min(0),
  observedMin: FiniteNumber.nullable(),
  observedMax: FiniteNumber.nullable(),
});
export type ColumnSchema = z.infer<typeof ColumnSchema>;

export const DatasetRef = z.strictObject({
  /** sha256 over the canonical serialisation of the parsed table (see hash.ts). */
  fingerprint: Sha256Hex,
  importedAt: IsoDateTime,
  rowCount: z.number().int().min(0),
  columns: z.array(ColumnSchema),
  /** Where the data came from, for display only (file name, "bundled example: tam"). */
  source: z.string().max(500).optional(),
  /** Bundled example datasets carry their provenance status from the fixtures index. */
  provenance: z
    .strictObject({
      synthetic: z.boolean(),
      licence: z.string().max(200).optional(),
      attribution: z.string().max(2000).optional(),
    })
    .optional(),
});
export type DatasetRef = z.infer<typeof DatasetRef>;
