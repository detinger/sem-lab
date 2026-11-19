/**
 * Content contract for Learn (PLAN §2.11), Challenges (§2.12) and Reference (glossary, theory
 * encyclopedia). Content lives as JSON under content/ and is validated against these schemas
 * by tests; the UI renders it. Text fields use a tiny inline markup: **bold**, *italic*,
 * `code`, and [[glossary-term-id]] links. No HTML.
 *
 * Files:
 *   content/lessons/L<level>-<nn>-<id>.json      Lesson
 *   content/challenges/C<nn>-<id>.json           Challenge
 *   content/reference/glossary.json              { terms: GlossaryTerm[] }
 *   content/reference/theories.json              { theories: Theory[] }
 *   content/citations/citations.json             { citations: Citation[] }  (keys must not clash
 *                                                with packages/method-registry citations; both
 *                                                sets are resolvable from content)
 */
import { AnalysisConfiguration, SemModel } from '@sem-lab/contracts';
import { z } from 'zod';

const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const Text = z.string().min(1).max(4000);

export const Citation = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9]*$/),
  text: Text,
  doi: z.string().optional(),
  url: z.string().url().optional(),
});
export type Citation = z.infer<typeof Citation>;

/** Interactive micro demonstrations implemented by the UI (one component per id). */
export const DemoId = z.enum([
  'reliability-from-loadings', // k standardized loadings → α (from implied r = λiλj), ρC, AVE
  'htmt', // mean hetero-/monotrait correlations → HTMT
  'vif', // R² of a predictor on the others → VIF = 1 / (1 − R²)
  'f2', // R² included / excluded → f² = (R²in − R²ex) / (1 − R²in)
  'mediation', // a, b, c′ → indirect a·b, total c′ + a·b; Zhao et al. (2010) typology by sign
  'bootstrap', // resample a small fixed sample with a seed → distribution, SE, percentile CI
  'ipma-rescale', // declared vs observed endpoints → 0–100 performance
  'rmsea-cfi', // χ², df, N (and baseline χ², df) → RMSEA, CFI with the CB engine's formulas
  'reflective-formative', // flip a mini model between Mode A/reflective and Mode B/formative
]);
export type DemoId = z.infer<typeof DemoId>;

export const Block = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('p'), text: Text }),
  z.strictObject({
    kind: z.literal('callout'),
    variant: z.enum(['info', 'warning', 'tip']),
    title: z.string().max(120).optional(),
    text: Text,
  }),
  z.strictObject({
    kind: z.literal('formula'),
    /** plain Unicode, e.g. "ρC = (Σλᵢ)² / ((Σλᵢ)² + Σ(1 − λᵢ²))" */
    display: z.string().min(1).max(400),
    /** what each symbol means, in words */
    explanation: Text,
  }),
  z.strictObject({
    kind: z.literal('diagram'),
    /** a small model (≤ 6 constructs); rendered read-only with automatic layout */
    model: SemModel,
    caption: z.string().max(400),
    /** construct/indicator/relationship ids to highlight */
    highlight: z.array(z.string()).default([]),
  }),
  z.strictObject({
    kind: z.literal('demo'),
    demo: DemoId,
    /** initial values; each demo documents its own keys */
    initial: z
      .record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.array(z.number())]))
      .default({}),
    caption: z.string().max(400).optional(),
  }),
  z.strictObject({
    kind: z.literal('list'),
    ordered: z.boolean().default(false),
    items: z.array(Text).min(1).max(12),
  }),
]);
export type Block = z.infer<typeof Block>;

const ChoiceOption = z.strictObject({
  id: z.string().regex(/^[a-z]$/),
  text: Text,
  correct: z.boolean(),
  /** shown when this option is chosen: why it is right or wrong */
  feedback: Text,
});

export const KnowledgeCheck = z
  .strictObject({
    id: Slug,
    question: Text,
    multiple: z.boolean().default(false),
    options: z.array(ChoiceOption).min(2).max(6),
    /** shown after answering, whatever was chosen */
    explanation: Text,
  })
  .refine((q) => q.options.some((o) => o.correct), 'at least one correct option')
  .refine(
    (q) => q.multiple || q.options.filter((o) => o.correct).length === 1,
    'single choice needs exactly one correct option',
  );
export type KnowledgeCheck = z.infer<typeof KnowledgeCheck>;

/** A starter opened as a NEW project (sandbox), like an example. */
export const Starter = z
  .strictObject({
    title: z.string().min(1).max(120),
    /** an id in content/examples, or */
    exampleId: Slug.optional(),
    /** an explicit model (optionally with a bundled dataset and analysis settings) */
    model: SemModel.optional(),
    bundledDatasetId: Slug.optional(),
    analysis: AnalysisConfiguration.optional(),
    /** page to open afterwards */
    open: z.enum(['modeler', 'data', 'analysis', 'results']).default('modeler'),
  })
  .refine((s) => Boolean(s.exampleId) !== Boolean(s.model), 'exactly one of exampleId / model');
export type Starter = z.infer<typeof Starter>;

export const Lesson = z.strictObject({
  id: Slug,
  level: z.number().int().min(1).max(6),
  order: z.number().int().min(1),
  title: z.string().min(1).max(100),
  /** one sentence: the single concept */
  summary: z.string().min(1).max(300),
  minutes: z.number().int().min(2).max(30),
  prerequisites: z.array(Slug).default([]),
  /** concept and practical relevance: 2–4 short paragraphs, at most one formula, one diagram or demo */
  body: z.array(Block).min(2).max(12),
  mistake: z.strictObject({ title: z.string().min(1).max(120), text: Text }),
  tryIt: z.strictObject({ task: Text, starter: Starter }).optional(),
  checks: z.array(KnowledgeCheck).min(1).max(3),
  /** citation keys (method registry or content/citations) */
  references: z.array(z.string()).min(1),
  glossary: z.array(Slug).default([]),
});
export type Lesson = z.infer<typeof Lesson>;

/** PLAN §2.12 assessment dimensions, scored separately. */
export const Dimension = z.enum([
  'structure',
  'mapping',
  'estimator',
  'numeric',
  'interpretation',
  'reporting',
]);
export type Dimension = z.infer<typeof Dimension>;

/** Structural expectations for the student's current model (layout is never scored). */
export const ModelCheck = z.strictObject({
  /** construct names are matched case-insensitively against any alias */
  constructs: z.array(
    z.strictObject({
      key: Slug,
      aliases: z.array(z.string().min(1)).min(1),
      measurement: z.enum(['reflective', 'composite-formative']).optional(),
      /** indicator names (case-insensitive); set equality when given */
      indicators: z.array(z.string().min(1)).optional(),
    }),
  ),
  /** directed structural paths between construct keys */
  paths: z.array(z.tuple([Slug, Slug])),
  /** true: no other structural paths allowed; false: extra paths only produce feedback */
  exactPaths: z.boolean().default(true),
  /** extra constructs are an error when false */
  allowExtraConstructs: z.boolean().default(false),
});
export type ModelCheck = z.infer<typeof ModelCheck>;

/** How a numeric answer key was derived, so a test can recompute it with the engine. */
export const Derivation = z.strictObject({
  /** a synthetic fixture case (packages/fixtures/synthetic/<case>) or an example id */
  source: z.strictObject({ fixture: Slug.optional(), exampleId: Slug.optional() }),
  analysis: AnalysisConfiguration,
  /** a NormalizedSemResult parameter key (e.g. "path:c_pu->c_bi"), or */
  parameterKey: z.string().optional(),
  field: z.enum(['est', 'se', 'statistic', 'pValue', 'ciLower', 'ciUpper']).optional(),
  /** construct metric (e.g. { constructId, metric: "ave" }), fit index name, or IPMA value */
  constructMetric: z.strictObject({ constructId: z.string(), metric: z.string() }).optional(),
  fitIndex: z.string().optional(),
  ipma: z
    .strictObject({ constructId: z.string(), value: z.enum(['importance', 'performance']) })
    .optional(),
});
export type Derivation = z.infer<typeof Derivation>;

const TaskBase = {
  id: Slug,
  dimension: Dimension,
  prompt: Text,
};

export const Task = z.discriminatedUnion('kind', [
  z.strictObject({
    ...TaskBase,
    kind: z.literal('choice'),
    multiple: z.boolean().default(false),
    options: z.array(ChoiceOption).min(2).max(6),
  }),
  z.strictObject({
    ...TaskBase,
    kind: z.literal('number'),
    answer: z.number(),
    /** absolute tolerance accepted */
    tolerance: z.number().positive(),
    unit: z.string().max(20).optional(),
    feedbackCorrect: Text,
    feedbackWrong: Text,
    derivation: Derivation.optional(),
  }),
  z.strictObject({ ...TaskBase, kind: z.literal('model'), check: ModelCheck }),
  z.strictObject({
    ...TaskBase,
    kind: z.literal('mapping'),
    /** indicator name → expected data column (case-sensitive column names) */
    expected: z.record(z.string(), z.string()),
    /** indicator names that must be marked reverse-scored with these endpoints */
    reverse: z
      .array(z.strictObject({ indicator: z.string(), min: z.number(), max: z.number() }))
      .default([]),
  }),
  z.strictObject({
    ...TaskBase,
    kind: z.literal('config'),
    /** expected analysis settings (subset): compared after parsing the Analysis page form */
    expected: z.strictObject({
      method: z.enum(['pls-sem', 'plsc', 'cb-sem']).optional(),
      estimator: z.string().optional(),
      missingData: z.enum(['listwise', 'fiml']).optional(),
      bootstrapAtLeast: z.number().int().optional(),
      ipmaTarget: z.string().optional(),
    }),
  }),
  z.strictObject({
    ...TaskBase,
    kind: z.literal('self-assess'),
    /** the student ticks what their work contains; scored as completed, never as right/wrong */
    checklist: z.array(Text).min(2).max(10),
  }),
]);
export type Task = z.infer<typeof Task>;

export const Challenge = z.strictObject({
  id: Slug,
  number: z.number().int().min(1),
  title: z.string().min(1).max(100),
  category: z.enum(['model', 'diagnose', 'analyze', 'interpret', 'report']),
  method: z.enum(['pls', 'cb', 'both']),
  difficulty: z.number().int().min(1).max(3),
  prerequisiteLessons: z.array(Slug).default([]),
  skills: z.array(z.string().min(1).max(60)).min(1),
  brief: z.array(Block).min(1).max(8),
  starter: Starter.optional(),
  tasks: z.array(Task).min(1).max(8),
  /** progressive; the last may come close to the answer but never states it outright */
  hints: z.array(Text).min(2).max(5),
  /** shown after the student submits (any score) or gives up */
  solution: z.array(Block).min(1).max(8),
  nextLesson: Slug.optional(),
});
export type Challenge = z.infer<typeof Challenge>;

export const GlossaryTerm = z.strictObject({
  id: Slug,
  term: z.string().min(1).max(80),
  aliases: z.array(z.string()).default([]),
  definition: Text,
  lessons: z.array(Slug).default([]),
  seeAlso: z.array(Slug).default([]),
});
export type GlossaryTerm = z.infer<typeof GlossaryTerm>;

export const Theory = z.strictObject({
  id: Slug,
  name: z.string().min(1).max(120),
  field: z.string().max(80),
  summary: Text,
  constructs: z
    .array(z.strictObject({ name: z.string(), abbreviation: z.string().max(12), definition: Text }))
    .min(2),
  relationships: z.array(Text).min(1),
  /** a small canonical model for the diagram */
  model: SemModel.optional(),
  /** example ids / notebook files that use it */
  examples: z.array(Slug).default([]),
  notebooks: z.array(z.string()).default([]),
  references: z.array(z.string()).min(1),
  caveats: Text.optional(),
});
export type Theory = z.infer<typeof Theory>;

export const Glossary = z.strictObject({ terms: z.array(GlossaryTerm).min(1) });
export const Theories = z.strictObject({ theories: z.array(Theory).min(1) });
export const Citations = z.strictObject({ citations: z.array(Citation) });
