/**
 * The bundled example projects (content/examples/*.json): model, analysis settings and the id
 * of the bundled dataset they run on. Loaded eagerly; the files are small.
 */
import { AnalysisConfiguration, SemModel } from '@sem-studio/contracts';
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

const ORDER = ['acsi-2015', 'tam-mediation', 'delone-mclean', 'service-quality'];

export const EXAMPLES: readonly Example[] = Object.values(files)
  .map(parseExample)
  .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
