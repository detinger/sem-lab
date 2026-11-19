import type { AnalysisConfiguration, SemLayout, SemModel } from '@sem-studio/contracts';
import { configFromAnalysis, useAnalysisConfig } from '@/features/analysis/config';
import { useDataLab } from '@/features/data-lab/store';
import { useModeler } from '@/features/modeler/store';
import type { Starter } from '@/features/learn/schema';
import { EXAMPLES, type Example } from './examples';

/** True when the open project holds a model the user could lose sight of. */
export function projectHasContent(): boolean {
  const { model } = useModeler.getState();
  return model.constructs.length > 0 || model.indicators.length > 0;
}

/** Everything needed to open a new project: a model, optionally data and analysis settings. */
export interface ProjectSpec {
  title: string;
  model: SemModel;
  /** a saved arrangement; automatic layout when absent */
  layout?: SemLayout | undefined;
  bundledDatasetId?: string | undefined;
  analysis?: AnalysisConfiguration | undefined;
}

/**
 * Open a spec as a NEW project (the current one stays in this browser's storage untouched):
 * model with automatic layout (same store path as the e2e `loadModel` hook), bundled dataset
 * through the Data Lab (which links it to the project), and the analysis settings.
 */
export async function openProject(spec: ProjectSpec): Promise<void> {
  useModeler.getState().newProject(spec.title);
  if (spec.layout) {
    const layout = spec.layout;
    useModeler.getState().edit(
      () => spec.model,
      () => layout,
    );
  } else {
    useModeler.getState().edit(() => spec.model);
    await useModeler.getState().autoArrange({ keepPinned: false });
  }
  if (spec.bundledDatasetId) {
    await useDataLab.getState().importBundled(spec.bundledDatasetId);
    const lab = useDataLab.getState();
    if (lab.status !== 'ready') throw new Error(lab.error ?? 'The data could not be loaded.');
  }
  if (spec.analysis) useAnalysisConfig.setState({ config: configFromAnalysis(spec.analysis) });
}

export const openExample = (example: Example): Promise<void> =>
  openProject({
    title: example.title,
    model: example.model,
    layout: example.layout,
    bundledDatasetId: example.dataset.bundledId,
    analysis: example.analysis,
  });

/** Resolve a lesson/challenge starter (an example id or an explicit model) to a project spec. */
export function resolveStarter(
  starter: Starter,
  examples: readonly Example[] = EXAMPLES,
): ProjectSpec {
  if (starter.exampleId) {
    const ex = examples.find((e) => e.id === starter.exampleId);
    if (!ex) throw new Error(`The starter example “${starter.exampleId}” is not available.`);
    return {
      title: starter.title,
      model: ex.model,
      bundledDatasetId: starter.bundledDatasetId ?? ex.dataset.bundledId,
      analysis: starter.analysis ?? ex.analysis,
    };
  }
  if (!starter.model) throw new Error('This starter has no model.');
  return {
    title: starter.title,
    model: starter.model,
    bundledDatasetId: starter.bundledDatasetId,
    analysis: starter.analysis,
  };
}

/** Open a starter as a new project and return the route to go to (`/modeler`, `/data`, …). */
export async function openStarter(
  starter: Starter,
  examples?: readonly Example[],
): Promise<string> {
  await openProject(resolveStarter(starter, examples));
  return `/${starter.open}`;
}
