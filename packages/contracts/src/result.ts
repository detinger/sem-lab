import { z } from 'zod';
import { EngineId } from './analysis.ts';
import { Id, IsoDateTime, MissingReason, Num, SCHEMA_VERSION, Severity } from './common.ts';

/**
 * Normalized engine output. Typed data, not display tables. See contracts.md §6.
 * Every `null` number must have a reason in the adjacent `missing` field.
 */

const NUMERIC_FIELDS = ['est', 'se', 'statistic', 'pValue', 'ciLower', 'ciUpper'] as const;

export const ParameterKind = z.enum([
  'path',
  'loading',
  'weight',
  'total-effect',
  'indirect-effect',
  'specific-indirect',
  'covariance',
  'variance',
  'residual-variance',
  'intercept',
  'threshold',
  'defined',
]);
export type ParameterKind = z.infer<typeof ParameterKind>;

export const ParameterEstimate = z
  .strictObject({
    key: z.string().min(1).max(400),
    kind: ParameterKind,
    sourceId: Id.optional(),
    targetId: Id.optional(),
    viaIds: z.array(Id).optional(),
    relationshipId: Id.optional(),
    scale: z.enum(['standardized', 'unstandardized']),
    est: Num,
    se: Num,
    statistic: Num,
    statisticType: z.enum(['t', 'z']).optional(),
    pValue: Num,
    ciLower: Num,
    ciUpper: Num,
    missing: z.partialRecord(z.enum(NUMERIC_FIELDS), MissingReason).optional(),
    status: z.enum(['estimated', 'fixed', 'not-estimated', 'failed']),
    inference: z
      .strictObject({
        method: z.enum(['bootstrap-percentile', 'bootstrap-bca', 'analytic', 'robust-analytic']),
        level: z.number().gt(0.5).lt(1),
        sides: z.enum(['two-sided', 'one-sided']),
        nValid: z.number().int().min(0).optional(),
      })
      .optional(),
    sourceMethod: z.string().min(1).max(200),
    rawPath: z.string().max(400).optional(),
  })
  .superRefine((p, ctx) => {
    for (const f of NUMERIC_FIELDS) {
      if (p[f] === null && !p.missing?.[f]) {
        ctx.addIssue({
          code: 'custom',
          path: [f],
          message: `${f} is null but no reason is given in missing.${f}`,
        });
      }
      if (p[f] !== null && p.missing?.[f]) {
        ctx.addIssue({
          code: 'custom',
          path: ['missing', f],
          message: `${f} has a value and a missing reason`,
        });
      }
    }
    if (p.pValue !== null && (p.pValue < 0 || p.pValue > 1)) {
      ctx.addIssue({ code: 'custom', path: ['pValue'], message: 'p value must lie in [0, 1]' });
    }
    if (p.ciLower !== null && p.ciUpper !== null && p.ciLower > p.ciUpper) {
      ctx.addIssue({
        code: 'custom',
        path: ['ciLower'],
        message: 'ciLower must not exceed ciUpper',
      });
    }
  });
export type ParameterEstimate = z.infer<typeof ParameterEstimate>;

const metricValue = z.strictObject({
  value: Num,
  missing: MissingReason.optional(),
}).shape;

function requireReason<T extends { value: number | null; missing?: MissingReason | undefined }>(
  v: T,
  ctx: z.core.$RefinementCtx<T>,
): void {
  if (v.value === null && !v.missing) {
    ctx.addIssue({
      code: 'custom',
      path: ['missing'],
      message: 'value is null but no missing reason is given',
    });
  }
  if (v.value !== null && v.missing) {
    ctx.addIssue({
      code: 'custom',
      path: ['missing'],
      message: 'value is present and a missing reason is given',
    });
  }
}

export const ConstructMetric = z
  .strictObject({
    constructId: Id,
    /** e.g. "cronbach-alpha", "rho-a", "rho-c", "ave", "r2", "r2-adjusted". */
    metric: z.string().min(1).max(80),
    ...metricValue,
    definition: z.string().min(1).max(1000),
  })
  .superRefine(requireReason);
export type ConstructMetric = z.infer<typeof ConstructMetric>;

export const ResultMatrix = z
  .strictObject({
    /** e.g. "htmt", "fornell-larcker", "cross-loadings", "latent-correlations", "residual-correlations". */
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(200),
    rowIds: z.array(Id),
    colIds: z.array(Id),
    values: z.array(z.array(Num)),
    symmetric: z.boolean(),
    definition: z.string().min(1).max(1000),
    missing: MissingReason.optional(),
  })
  .superRefine((m, ctx) => {
    if (m.values.length !== m.rowIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['values'],
        message: 'values must have one row per rowId',
      });
    }
    m.values.forEach((row, i) => {
      if (row.length !== m.colIds.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['values', i],
          message: 'each row must have one value per colId',
        });
      }
    });
  });
export type ResultMatrix = z.infer<typeof ResultMatrix>;

export const FitIndex = z
  .strictObject({
    /** e.g. "chisq", "df", "pvalue", "cfi", "tli", "rmsea", "srmr", "aic", "bic", "d_uls", "d_g". */
    name: z.string().min(1).max(80),
    ...metricValue,
    ciLower: Num.optional(),
    ciUpper: Num.optional(),
    variant: z.enum(['standard', 'scaled', 'robust']).optional(),
    definition: z.string().min(1).max(1000),
  })
  .superRefine(requireReason);
export type FitIndex = z.infer<typeof FitIndex>;

export const BootstrapSummary = z
  .strictObject({
    requested: z.number().int().min(0),
    completed: z.number().int().min(0),
    failed: z.number().int().min(0),
    inadmissible: z.number().int().min(0),
    seed: z.number().int().min(0),
    ciMethod: z.enum(['percentile', 'bca']),
    confidenceLevel: z.number().gt(0.5).lt(1),
    chunkSize: z.number().int().min(1),
    /** Optional raw draws for selected parameters, keyed by ParameterEstimate.key. */
    draws: z.record(z.string(), z.array(z.number().refine(Number.isFinite))).optional(),
  })
  .refine((b) => b.completed + b.failed + b.inadmissible <= b.requested, {
    message: 'completed + failed + inadmissible cannot exceed requested',
  });
export type BootstrapSummary = z.infer<typeof BootstrapSummary>;

export const IpmaResult = z.strictObject({
  targetConstructId: Id,
  constructs: z.array(
    z.strictObject({
      constructId: Id,
      importance: Num,
      performance: Num,
      predecessor: z.enum(['direct', 'indirect']),
    }),
  ),
  indicators: z
    .array(
      z.strictObject({
        indicatorId: Id,
        constructId: Id,
        importance: Num,
        performance: Num,
      }),
    )
    .optional(),
  /** Plain-language statement of the rescaling and weighting conventions used. */
  convention: z.string().min(1).max(2000),
});
export type IpmaResult = z.infer<typeof IpmaResult>;

export const ResultWarning = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  severity: Severity,
  message: z.string().min(1).max(2000),
  elementIds: z.array(Id).optional(),
});
export type ResultWarning = z.infer<typeof ResultWarning>;

export const NormalizedSemResult = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  sample: z
    .strictObject({
      nRows: z.number().int().min(0),
      nUsed: z.number().int().min(0),
      nDropped: z.number().int().min(0),
      missingData: z.enum(['listwise', 'fiml']),
    })
    .refine((s) => s.nUsed + s.nDropped === s.nRows, {
      message: 'nUsed + nDropped must equal nRows',
    }),
  estimation: z.strictObject({
    converged: z.boolean(),
    iterations: Num,
    admissible: z.boolean().nullable(),
    messages: z.array(z.string().max(2000)),
  }),
  parameters: z.array(ParameterEstimate),
  constructMetrics: z.array(ConstructMetric),
  matrices: z.array(ResultMatrix),
  fit: z.array(FitIndex),
  bootstrap: BootstrapSummary.optional(),
  ipma: IpmaResult.optional(),
  warnings: z.array(ResultWarning),
  provenance: z.strictObject({
    engine: EngineId,
    packageVersions: z.record(z.string(), z.string()),
    rVersion: z.string().optional(),
    pythonVersion: z.string().optional(),
    call: z.string().max(4000),
    startedAt: IsoDateTime,
    finishedAt: IsoDateTime,
  }),
});
export type NormalizedSemResult = z.infer<typeof NormalizedSemResult>;
