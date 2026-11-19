import { type EstimateInput, estimate } from '@sem-lab/engine';
import type { AnalysisConfiguration } from '@sem-lab/contracts';
import { describe, expect, it } from 'vitest';
import { TAM_ANALYSIS, loadFixtureCase } from '../test-support';
import { createDrawHandler } from './draw-core';
import { DrawPool, type PoolWorker } from './pool';
import type { FromDrawWorker } from './protocol';
import { runCore } from './run-core';
import { batchSizeFor, engineInput, poolSize, runEstimate } from './runtime';

async function tamInput(reps: number, seed = 7): Promise<EstimateInput> {
  const { model, data } = await loadFixtureCase('tam-mediation');
  const analysis: AnalysisConfiguration = {
    ...TAM_ANALYSIS,
    engine: 'browser',
    seed,
    bootstrap: {
      enabled: true,
      repetitions: reps,
      ci: 'percentile',
      confidenceLevel: 0.95,
      sides: 'two-sided',
    },
  };
  return engineInput(model, analysis, data);
}

/** provenance timestamps differ between runs; everything else must be identical */
const canon = (o: unknown): string =>
  JSON.stringify(o, (k, v: unknown) => (k === 'startedAt' || k === 'finishedAt' ? 'T' : v));

/** In-process stand-in for a Web Worker: structured-clones messages, replies out of order. */
function fakeWorker(delay: () => number): PoolWorker {
  let cb: (m: FromDrawWorker) => void = () => undefined;
  let dead = false;
  const handle = createDrawHandler((m) => {
    const copy = structuredClone(m);
    setTimeout(() => !dead && cb(copy), delay());
  });
  return {
    post: (m) => handle(structuredClone(m)),
    terminate: () => (dead = true),
    onMessage: (f) => (cb = f),
    onError: () => undefined,
  };
}

describe('pool of draw workers', () => {
  it('equals a single-threaded estimate() byte for byte (cloned, out-of-order executor)', async () => {
    const input = await tamInput(60);
    const single = await estimate(input, { batchSize: 25 });
    let n = 0;
    const pool = new DrawPool(() => fakeWorker(() => ((n++ * 7) % 5) * 3), 4);
    const pooled = await runCore(input, {
      isCancelled: () => false,
      batchSize: batchSizeFor(4),
      executeDraws: pool.executeDraws,
    });
    pool.terminate();
    expect(single.ok && pooled.ok).toBe(true);
    expect(canon(pooled)).toBe(canon(single));
    if (pooled.ok) expect(pooled.result.bootstrap?.requested).toBe(60);
  });

  it('cancel stops between draws and yields no result', async () => {
    const input = await tamInput(400);
    const pool = new DrawPool(() => fakeWorker(() => 1), 3);
    let batches = 0;
    const out = await runCore(input, {
      isCancelled: () => false,
      batchSize: 24,
      executeDraws: (p, b) => {
        if (++batches === 2) pool.terminate();
        return pool.executeDraws(p, b);
      },
    });
    expect(out).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });

  it('falls back in-process when every worker dies, with the same result', async () => {
    const input = await tamInput(30);
    const single = await estimate(input, {});
    const dying = (): PoolWorker => {
      let err: () => void = () => undefined;
      return {
        post: () => setTimeout(() => err(), 0),
        terminate: () => undefined,
        onMessage: () => undefined,
        onError: (f) => (err = f),
      };
    };
    const pool = new DrawPool(dying, 2);
    const pooled = await runCore(input, {
      isCancelled: () => false,
      batchSize: 16,
      executeDraws: pool.executeDraws,
    });
    expect(canon(pooled)).toBe(canon(single));
  });
});

describe('runEstimate (main-thread fallback, no Workers in jsdom)', () => {
  it('produces the same result as calling estimate directly, with real progress counts', async () => {
    const input = await tamInput(50);
    const direct = await estimate(input, {});
    const events: Array<{ stage: string; done?: number; total?: number }> = [];
    const out = await runEstimate(input, { onProgress: (e) => events.push(e) }).promise;
    expect(canon({ ok: out.ok, ...(out.ok ? { result: out.result } : {}) })).toBe(canon(direct));
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
    const boot = events.filter((e) => e.stage === 'bootstrapping');
    expect(boot[0]).toMatchObject({ done: 0, total: 50 });
    expect(boot.at(-1)).toMatchObject({ done: 50, total: 50 });
    const dones = boot.map((e) => e.done!);
    expect(dones).toEqual([...dones].sort((a, b) => a - b));
    expect(events.map((e) => e.stage)).toContain('summarizing');
  });

  it('cancel stops between draws and records no result', async () => {
    const input = await tamInput(2000);
    let last = 0;
    const handle = runEstimate(input, {
      onProgress: (e) => {
        if (e.stage === 'bootstrapping') {
          last = e.done ?? 0;
          if (last >= 50) handle.cancel();
        }
      },
    });
    const out = await handle.promise;
    expect(out).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(last).toBeLessThan(2000);
  });

  it('runs CB-SEM through the same entry point', async () => {
    const { model, data } = await loadFixtureCase('service-quality');
    const out = await runEstimate(
      engineInput(
        model,
        {
          method: 'cb-sem',
          engine: 'browser',
          estimator: 'ML',
          missingData: 'listwise',
          cb: { identification: 'marker', meanStructure: false },
        },
        data,
      ),
      { mode: 'main' },
    ).promise;
    expect(out.ok).toBe(true);
  });
});

describe('pool size', () => {
  it('is max(1, min(cores - 1, 8))', () => {
    expect([poolSize(1), poolSize(2), poolSize(4), poolSize(16), poolSize(Number.NaN)]).toEqual([
      1, 1, 3, 8, 1,
    ]);
  });
});
