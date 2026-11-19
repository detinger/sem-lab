import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NormalizedSemResult, SemModel, modelHash } from '@sem-studio/contracts';
import { useDataLab } from '@/features/data-lab/store';
import { useModeler } from '@/features/modeler/store';
import { type StoredRun, finishRun, makeRun, saveRun } from './runs';
import type { AnalysisConfiguration } from '@sem-studio/contracts';

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
    serverJobId: 'job-1',
  });
  const done = finishRun(run, { status: 'complete', result: FIXTURE_RESULT });
  await saveRun(done);
  return done;
}
