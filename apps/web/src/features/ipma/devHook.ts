/**
 * Dev-only test hook (registered only when `import.meta.env.DEV`, never in a production build).
 * Playwright calls `window.__semStudioTest.loadIpmaFixture()` to open the stored real-engine IPMA
 * fixture as a current run of the open project, without a running analysis service.
 */
import { NormalizedSemResult, SemModel, modelHash } from '@sem-studio/contracts';
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
    serverJobId: 'fixture',
  });
  await saveRun(
    finishRun(run, { status: 'complete', result: NormalizedSemResult.parse(resultJson) }),
  );
  await useRuns.getState().refresh(st.projectId);
}

declare global {
  interface Window {
    __semStudioTest?: { loadIpmaFixture: typeof loadIpmaFixture };
  }
}

export function registerDevHook(): void {
  window.__semStudioTest = { loadIpmaFixture };
}
