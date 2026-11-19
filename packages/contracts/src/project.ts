import { z } from 'zod';
import { AnalysisConfiguration, EngineId, SemMethod } from './analysis.ts';
import { Id, IsoDateTime, SCHEMA_VERSION, Severity, Sha256Hex } from './common.ts';
import { DatasetRef } from './dataset.ts';
import { SemLayout } from './layout.ts';
import { SemModel } from './model.ts';
import { NormalizedSemResult } from './result.ts';

export const SemProject = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: Id,
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  model: SemModel,
  layout: SemLayout,
  datasetRef: DatasetRef.optional(),
  currentAnalysis: AnalysisConfiguration.optional(),
});
export type SemProject = z.infer<typeof SemProject>;

export const RunStatus = z.enum(['queued', 'running', 'complete', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatus>;

/** Immutable record binding a result to the exact model, data and configuration. */
export const AnalysisRun = z
  .strictObject({
    runId: Id,
    schemaVersion: z.literal(SCHEMA_VERSION),
    modelHash: Sha256Hex,
    dataFingerprint: Sha256Hex,
    method: SemMethod,
    engine: EngineId,
    packageVersions: z.record(z.string(), z.string()),
    options: AnalysisConfiguration,
    status: RunStatus,
    createdAt: IsoDateTime,
    warnings: z.array(
      z.strictObject({ code: z.string(), message: z.string(), severity: Severity }),
    ),
    result: NormalizedSemResult.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.result && r.status !== 'complete') {
      ctx.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'only a complete run may carry a result',
      });
    }
    if (r.options.method !== r.method || r.options.engine !== r.engine) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'options.method/engine must match the run',
      });
    }
  });
export type AnalysisRun = z.infer<typeof AnalysisRun>;
