/**
 * Dev-only test hook (registered only when `import.meta.env.DEV`, never in a production build).
 * Playwright calls `window.__semStudioTest.loadIpmaFixture()` to open the stored real-engine IPMA
 * fixture as a current run of the open project, without a running analysis service.
 */
import { NormalizedSemResult, SemModel, modelHash } from '@sem-studio/contracts';
import { setWorkersOverride } from '@/features/analysis/engine';
import { finishRun, makeRun, saveRun, useRuns } from '@/features/analysis/runs';
import { useModeler } from '@/features/modeler/store';
import request from './__fixtures__/ipma-request.json';
import resultJson from './__fixtures__/ipma-result.json';

export async function loadIpmaFixture(): Promise<void> {
  const model = SemModel.parse(request.model);
  const s = useModeler.getState();
  s.newProject('IPMA fixture');
  useModeler.getState().edit(() => model);
  const fingerprint = 'f'.repeat(64);
  useModeler.getState().setDatasetRef({
    fingerprint,
    importedAt: new Date().toISOString(),
    rowCount: 400,
    columns: [],
    source: 'fixture',
  });
  const st = useModeler.getState();
  const run = makeRun({
    projectId: st.projectId,
    model: st.model,
    analysis: request.analysis as never,
    modelHash: await modelHash(st.model),
    dataFingerprint: fingerprint,
  });
  await saveRun(
    finishRun(run, { status: 'complete', result: NormalizedSemResult.parse(resultJson) }),
  );
  await useRuns.getState().refresh(st.projectId);
}

/** Replace the open project's model (the data are loaded through the Data page as usual). */
export async function loadModel(json: unknown, name = 'Test model'): Promise<void> {
  const model = SemModel.parse(json);
  useModeler.getState().newProject(name);
  useModeler.getState().edit(() => model);
  await useModeler.getState().autoArrange({ keepPinned: false });
}

/** The newest stored run of the open project: duration and the result, for end-to-end checks. */
export function lastRun(): { status: string; durationMs: number | null; result: unknown } | null {
  const r = useRuns.getState().runs[0];
  return r
    ? { status: r.record.status, durationMs: r.durationMs ?? null, result: r.record.result ?? null }
    : null;
}

declare global {
  interface Window {
    __semStudioTest?: {
      loadIpmaFixture: typeof loadIpmaFixture;
      loadModel: typeof loadModel;
      lastRun: typeof lastRun;
      setWorkers: typeof setWorkersOverride;
    };
  }
}

export function registerDevHook(): void {
  window.__semStudioTest = {
    loadIpmaFixture,
    loadModel,
    lastRun,
    setWorkers: setWorkersOverride,
  };
}
