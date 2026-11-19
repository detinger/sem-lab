import { z } from 'zod';
import { Id } from './common.ts';

/** Analysis configuration. See docs/architecture/contracts.md §5. */

export const SemMethod = z.enum(['pls-sem', 'plsc', 'cb-sem']);
export type SemMethod = z.infer<typeof SemMethod>;

/** 'browser' = SEM Lab's own TypeScript engine (packages/engine), verified against the R engines. */
export const EngineId = z.enum([
  'browser',
  'r-csem',
  'r-seminr',
  'r-lavaan',
  'py-semopy',
  'py-plspm',
]);
export type EngineId = z.infer<typeof EngineId>;

/** Which engines can run which method at all. Finer gating is the capability registry's job. */
export const ENGINES_BY_METHOD: Readonly<Record<SemMethod, readonly EngineId[]>> = {
  'pls-sem': ['browser', 'r-csem', 'r-seminr', 'py-plspm'],
  plsc: ['browser', 'r-csem', 'r-seminr'],
  'cb-sem': ['browser', 'r-lavaan', 'py-semopy'],
};

export const BootstrapConfig = z.strictObject({
  enabled: z.boolean(),
  repetitions: z.number().int().min(1).max(100_000),
  ci: z.enum(['percentile', 'bca']),
  confidenceLevel: z.number().gt(0.5).lt(1),
  sides: z.enum(['two-sided', 'one-sided']),
});
export type BootstrapConfig = z.infer<typeof BootstrapConfig>;

export const PlsOptions = z.strictObject({
  innerWeighting: z.enum(['path', 'centroid', 'factorial']),
  maxIterations: z.number().int().min(1).max(100_000),
  tolerance: z.number().positive().max(0.01),
});
export type PlsOptions = z.infer<typeof PlsOptions>;

export const CbOptions = z.strictObject({
  identification: z.enum(['marker', 'std-lv']),
  meanStructure: z.boolean(),
});
export type CbOptions = z.infer<typeof CbOptions>;

export const AnalysisConfiguration = z
  .strictObject({
    method: SemMethod,
    engine: EngineId,
    /** Checked against the capability registry for (method, engine). "pls-pm" for PLS/PLSc; lavaan names for CB. */
    estimator: z.string().min(1).max(40),
    missingData: z.enum(['listwise', 'fiml']),
    /** 32-bit unsigned so R (set.seed) and numpy accept it identically. Required when bootstrapping. */
    seed: z.number().int().min(0).max(2_147_483_647).optional(),
    bootstrap: BootstrapConfig.optional(),
    pls: PlsOptions.optional(),
    cb: CbOptions.optional(),
    ipma: z.strictObject({ targetConstructId: Id }).optional(),
  })
  .superRefine((a, ctx) => {
    if (!ENGINES_BY_METHOD[a.method].includes(a.engine)) {
      ctx.addIssue({
        code: 'custom',
        path: ['engine'],
        message: `engine ${a.engine} cannot run method ${a.method}`,
      });
    }
    if (a.bootstrap?.enabled && a.seed === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['seed'],
        message: 'a seed is required when bootstrapping is enabled',
      });
    }
    if (a.method === 'cb-sem' && a.pls) {
      ctx.addIssue({
        code: 'custom',
        path: ['pls'],
        message: 'PLS options are not valid for CB-SEM',
      });
    }
    if (a.method !== 'cb-sem' && a.cb) {
      ctx.addIssue({
        code: 'custom',
        path: ['cb'],
        message: 'CB options are only valid for CB-SEM',
      });
    }
    if (a.missingData === 'fiml' && a.method !== 'cb-sem') {
      ctx.addIssue({
        code: 'custom',
        path: ['missingData'],
        message: 'FIML is only defined for CB-SEM estimators',
      });
    }
  });
export type AnalysisConfiguration = z.infer<typeof AnalysisConfiguration>;
