import { configFromAnalysis, useAnalysisConfig } from '@/features/analysis/config';
import { useDataLab } from '@/features/data-lab/store';
import { useModeler } from '@/features/modeler/store';
import type { Example } from './examples';

/** True when the open project holds a model the user could lose sight of. */
export function projectHasContent(): boolean {
  const { model } = useModeler.getState();
  return model.constructs.length > 0 || model.indicators.length > 0;
}

/**
 * Open an example as a NEW project (the current one stays in this browser's storage untouched):
 * model with automatic layout (same store path as the e2e `loadModel` hook), bundled dataset
 * through the Data Lab (which links it to the project), and the example's analysis settings.
 */
export async function openExample(example: Example): Promise<void> {
  useModeler.getState().newProject(example.title);
  useModeler.getState().edit(() => example.model);
  await useModeler.getState().autoArrange({ keepPinned: false });
  await useDataLab.getState().importBundled(example.dataset.bundledId);
  const lab = useDataLab.getState();
  if (lab.status !== 'ready') throw new Error(lab.error ?? 'The example data could not be loaded.');
  useAnalysisConfig.setState({ config: configFromAnalysis(example.analysis) });
}
