import 'fake-indexeddb/auto';
import { modelHash } from '@sem-lab/contracts';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME, resetDbForTests } from '@/storage/projects';
import { updateConstruct } from '@/domain/model-ops';
import { FIXTURE_RESULT, TAM_ANALYSIS, TAM_MODEL } from './test-support';
import { finishRun, getRun, listRuns, makeRun, saveRun, stalenessOf } from './runs';

afterEach(async () => {
  resetDbForTests();
  await Dexie.delete(DB_NAME);
});

const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);

async function newRun() {
  return makeRun({
    projectId: 'p1',
    model: TAM_MODEL,
    analysis: TAM_ANALYSIS,
    modelHash: await modelHash(TAM_MODEL),
    dataFingerprint: FP_A,
  });
}

describe('run records', () => {
  it('is current while model and data are unchanged', async () => {
    const run = await newRun();
    expect(stalenessOf(run, { modelHash: run.modelHash, dataFingerprint: FP_A })).toBe('current');
  });

  it('is stale when a construct is renamed', async () => {
    const run = await newRun();
    const first = TAM_MODEL.constructs[0]!;
    const changed = updateConstruct(TAM_MODEL, first.id, { name: `${first.name} changed` });
    const hash = await modelHash(changed);
    expect(hash).not.toBe(run.modelHash);
    expect(stalenessOf(run, { modelHash: hash, dataFingerprint: FP_A })).toBe('model');
  });

  it('is stale when the data fingerprint differs or no data is linked', async () => {
    const run = await newRun();
    expect(stalenessOf(run, { modelHash: run.modelHash, dataFingerprint: FP_B })).toBe('data');
    expect(stalenessOf(run, { modelHash: run.modelHash, dataFingerprint: null })).toBe('data');
  });

  it('stores runs, lists them newest first and refuses to change a finished run', async () => {
    const run = await newRun();
    await saveRun(run);
    const done = finishRun(run, { status: 'complete', result: FIXTURE_RESULT });
    await saveRun(done);
    expect((await getRun(run.runId))?.record.status).toBe('complete');
    expect((await listRuns('p1')).map((r) => r.runId)).toEqual([run.runId]);
    const tampered = { ...done, record: { ...done.record, status: 'failed' as const } };
    await expect(saveRun(tampered)).rejects.toThrow(/immutable/);
    expect(() =>
      finishRun(done, { status: 'cancelled', failure: { code: 'CANCELLED', message: 'x' } }),
    ).toThrow(/immutable/);
  });
});
