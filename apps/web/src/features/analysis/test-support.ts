import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NormalizedSemResult, SemModel, modelHash } from '@sem-lab/contracts';
import { useDataLab } from '@/features/data-lab/store';
import { useModeler } from '@/features/modeler/store';
import { buildAnalysisData } from '@/domain/dataset/analysis-data';
import { createDataset, isDatasetError } from '@/domain/dataset/transform';
import type { AnalysisData, Dataset } from '@/domain/dataset/types';
import { type StoredRun, finishRun, makeRun, saveRun } from './runs';
import type { AnalysisConfiguration } from '@sem-lab/contracts';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
export const TAM_CSV = readFileSync(
  join(ROOT, 'packages/fixtures/synthetic/tam-mediation/data.csv'),
  'utf8',
);
const fx = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '..', 'results', '__fixtures__', name), 'utf8'));
export const FIXTURE_RESULT = NormalizedSemResult.parse(fx('tam-mediation-result.json'));
const req = fx('tam-mediation-request.json') as { model: unknown; analysis: unknown };
export const TAM_MODEL = SemModel.parse(req.model);
export const TAM_ANALYSIS = req.analysis as AnalysisConfiguration;

/** The TAM mediation model + data loaded as an open project (data link set by the Data Lab). */
export async function openTamProject(): Promise<void> {
  const modeler = useModeler.getState();
  modeler.newProject('TAM test');
  useDataLab.getState().clear();
  useModeler.getState().edit(() => TAM_MODEL);
  await useDataLab
    .getState()
    .importText(TAM_CSV, { name: 'tam', source: { kind: 'file', fileName: 'tam.csv' } });
}

/** Save a complete run bound to the CURRENT model and data. */
export async function saveCompleteRun(): Promise<StoredRun> {
  const s = useModeler.getState();
  const run = makeRun({
    projectId: s.projectId,
    model: s.model,
    analysis: TAM_ANALYSIS,
    modelHash: await modelHash(s.model),
    dataFingerprint: s.datasetRef!.fingerprint,
  });
  const done = finishRun(run, { status: 'complete', result: FIXTURE_RESULT });
  await saveRun(done);
  return done;
}

const FIXTURE_ROOT = join(ROOT, 'packages/fixtures/synthetic');

/** A synthetic fixture case: model, parsed dataset and the analysis matrix the app would build. */
export async function loadFixtureCase(
  id: string,
  missingData: 'listwise' | 'fiml' = 'listwise',
): Promise<{ model: SemModel; dataset: Dataset; data: AnalysisData; csv: string }> {
  const model = SemModel.parse(
    JSON.parse(readFileSync(join(FIXTURE_ROOT, id, 'model.json'), 'utf8')),
  );
  const csv = readFileSync(join(FIXTURE_ROOT, id, 'data.csv'), 'utf8');
  const dataset = await createDataset(csv, {
    name: id,
    source: { kind: 'bundled', exampleId: id },
    id: 'd',
    importedAt: '2026-11-19T00:00:00Z',
  });
  if (isDatasetError(dataset)) throw new Error(dataset.error.message);
  const data = buildAnalysisData(model, dataset, missingData);
  if ('error' in data) throw new Error(data.error.message);
  return { model, dataset, data, csv };
}

const resultFx = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '..', 'results', '__fixtures__', name), 'utf8'));

/** A stored CB-SEM fixture: request (model + analysis) and the real engine result. */
export function cbFixture(name: 'cb-service-quality-ml' | 'cb-service-quality-mlr' | 'cb-heywood') {
  const r = resultFx(`${name}-request.json`) as { model: unknown; analysis: unknown };
  return {
    model: SemModel.parse(r.model),
    analysis: r.analysis as AnalysisConfiguration,
    result: NormalizedSemResult.parse(resultFx(`${name}-result.json`)),
  };
}

/** Open the fixture case as the project (model + imported data) and store its complete CB run. */
export async function openCbProjectWithRun(
  name: 'cb-service-quality-ml' | 'cb-service-quality-mlr' | 'cb-heywood',
  caseId: string,
): Promise<StoredRun> {
  const fx = cbFixture(name);
  const { csv } = await loadFixtureCase(caseId);
  useModeler.getState().newProject('CB test');
  useDataLab.getState().clear();
  useModeler.getState().edit(() => fx.model);
  await useDataLab
    .getState()
    .importText(csv, { name: caseId, source: { kind: 'file', fileName: `${caseId}.csv` } });
  const s = useModeler.getState();
  const run = makeRun({
    projectId: s.projectId,
    model: s.model,
    analysis: fx.analysis,
    modelHash: await modelHash(s.model),
    dataFingerprint: s.datasetRef!.fingerprint,
  });
  const done = finishRun(run, { status: 'complete', result: fx.result, durationMs: 120 });
  await saveRun(done);
  return done;
}
