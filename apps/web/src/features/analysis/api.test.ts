import { describe, expect, it, vi } from 'vitest';

describe('analysis API client', () => {
  it('refuses to call anything when no service is configured', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.resetModules();
    const { api, API_BASE_URL } = await import('./api');
    expect(API_BASE_URL).toBeNull();
    await expect(api.health()).rejects.toMatchObject({ code: 'API_NOT_CONFIGURED' });
    vi.unstubAllEnvs();
  });

  it('uploads only the analysis matrix as CSV and never puts data in the URL', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/');
    vi.resetModules();
    const { api, analysisCsv } = await import('./api');
    const data = {
      columns: ['x1', 'odd,name'],
      rows: [
        [1, 2.5],
        [3, 4],
      ],
      nRows: 3,
      nUsed: 2,
      nDropped: 1,
      missingData: 'listwise' as const,
    };
    expect(analysisCsv(data)).toBe('x1,"odd,name"\n1,2.5\n3,4\n');
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.example.test/api/analysis/jobs');
      expect(url).not.toContain('2.5');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('omit');
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'job1', status: 'queued' }), { status: 202 }),
      );
    });
    const out = await api.submitJob(
      { constructs: [], indicators: [], relationships: [] },
      { method: 'pls-sem', engine: 'r-csem', estimator: 'pls-pm', missingData: 'listwise' },
      data,
      fetchMock as unknown as typeof fetch,
    );
    expect(out.id).toBe('job1');
    const form = fetchMock.mock.calls[0]![1]!.body as FormData;
    expect(await (form.get('data') as Blob).text()).toBe(analysisCsv(data));
    expect(JSON.parse(form.get('request') as string)).toHaveProperty('analysis.method', 'pls-sem');
    vi.unstubAllEnvs();
  });

  it('turns API error bodies into typed errors and rejects results that break the contract', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test');
    vi.resetModules();
    const { api } = await import('./api');
    const err = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: 'CAPABILITY_UNSUPPORTED', message: 'BCa is planned' } }),
          { status: 422 },
        ),
      ),
    );
    await expect(api.status('j', err as unknown as typeof fetch)).rejects.toMatchObject({
      status: 422,
      code: 'CAPABILITY_UNSUPPORTED',
      message: 'BCa is planned',
    });
    const bad = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ schemaVersion: 1, sample: {} }), { status: 200 }),
      ),
    );
    await expect(api.result('j', bad as unknown as typeof fetch)).rejects.toMatchObject({
      code: 'RESULT_INVALID',
    });
    const down = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(api.health(down as unknown as typeof fetch)).rejects.toMatchObject({
      code: 'NETWORK',
    });
    vi.unstubAllEnvs();
  });
});
