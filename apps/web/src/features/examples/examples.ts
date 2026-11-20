/**
 * The bundled example projects (content/examples/*.json): model, analysis settings and the id
 * of the bundled dataset they run on. Loaded eagerly; the files are small.
 */
import { AnalysisConfiguration, SemLayout, SemModel } from '@sem-lab/contracts';
import { z } from 'zod';

const ExampleFile = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  theory: z.string().min(1),
  modelNote: z.string(),
  scaleSource: z.string(),
  dataset: z.object({
    bundledId: z.string().min(1),
    synthetic: z.boolean(),
    licence: z.string().optional(),
    attribution: z.string().optional(),
    note: z.string().optional(),
  }),
  model: SemModel,
  /** optional hand-arranged layout (exported from the Modeler); automatic layout otherwise */
  layout: SemLayout.optional(),
  /** draw every single-indicator construct as an observed-variable box (path models) */
  observedVariables: z.boolean().optional(),
  analysis: AnalysisConfiguration,
});
export type Example = z.infer<typeof ExampleFile>;

const files = import.meta.glob<unknown>('../../../../../content/examples/*.json', {
  eager: true,
  import: 'default',
});

export function parseExample(raw: unknown): Example {
  return ExampleFile.parse(raw);
}

const ORDER = [
  'acsi-2015',
  'acsi-inspired',
  'tam-mediation',
  'delone-mclean',
  'utaut2-inspired',
  'service-quality',
  'path-study-success',
  'path-work-wellbeing',
  'regression-house-prices',
  'regression-sleep-quality',
];

export const EXAMPLES: readonly Example[] = Object.values(files)
  .map(parseExample)
  .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
