import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui';
import { useDataLab } from '@/features/data-lab/store';
import { useModeler } from '@/features/modeler/store';
import { DB_NAME, resetDbForTests } from '@/storage/projects';
import { AnalysisPage } from './AnalysisPage';
import { defaultConfig, toConfiguration, useAnalysisConfig } from './config';
import { useJobs } from './jobs';
import { useRuns } from './runs';
import { loadFixtureCase, openTamProject } from './test-support';

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/analysis']}>
        <Routes>
          <Route path="/analysis" element={<AnalysisPage />} />
          <Route path="/results" element={<p>results page</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

const setConfig = (patch: Partial<ReturnType<typeof defaultConfig>>) =>
  useAnalysisConfig.setState({ config: { ...defaultConfig(42), ...patch } });

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  window.localStorage.clear();
  fetchSpy = vi.fn(() => Promise.reject(new Error('no network in the Analysis flow')));
  vi.stubGlobal('fetch', fetchSpy);
  setConfig({});
  useJobs.setState({ active: null, outcome: null });
  useRuns.setState({ projectId: null, runs: [], selectedRunId: null });
  await openTamProject();
});

afterEach(async () => {
  resetDbForTests();
  await Dexie.delete(DB_NAME);
});

describe('configuration', () => {
  it('gates options by the registry: BCa disabled with the reason, CB-SEM and centroid enabled', async () => {
    renderPage();
    const bca = await screen.findByRole('option', { name: /BCa/ });
    expect(bca).toBeDisabled();
    expect(screen.getByText(/BCa unavailable: .*not implemented/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Centroid' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /CB-SEM/ })).toBeEnabled();
  });

  it('names the in-browser engine and states the privacy line', async () => {
    renderPage();
    expect(await screen.findAllByText(/SEM Lab engine \(runs in this browser\)/)).not.toHaveLength(
      0,
    );
    expect(
      screen.getAllByText('Your data stay on this device; nothing is uploaded.'),
    ).not.toHaveLength(0);
  });

  it('shows what listwise deletion will do', async () => {
    renderPage();
    expect(await screen.findByText(/rows will be used/)).toHaveTextContent(
      /of .* rows will be used/,
    );
  });

  it('disables Run analysis while an error remains', async () => {
    useModeler.getState().edit((m) => ({
      ...m,
      indicators: m.indicators.map((i, k) => (k === 0 ? { ...i, column: null } : i)),
    }));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Run analysis' })).toBeDisabled();
    expect(screen.getByText(/disabled while an error remains/)).toBeInTheDocument();
  });
});

describe('CB-SEM options', () => {
  it('offers ML and MLR, disables MLM and WLSMV with the registry reasons, hides the bootstrap', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('radio', { name: /CB-SEM/ }));
    expect(screen.getByRole('radio', { name: 'ML' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'MLR' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'MLM' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'WLSMV' })).toBeDisabled();
    expect(screen.getByText(/MLM \(Satorra/)).toBeInTheDocument();
    expect(screen.getByText(/Ordinal estimation \(WLSMV\/DWLS\)/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Bootstrap samples (B)')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Bootstrap for CB-SEM is not available yet; standard errors are analytic (ML: expected information; MLR: robust sandwich; FIML: observed information).',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'FIML' }));
    expect(screen.getByText(/FIML implies a mean structure/)).toBeInTheDocument();
  });

  it('builds the CB configuration for the browser engine (FIML turns the mean structure on)', () => {
    const ml = toConfiguration({ ...defaultConfig(1), method: 'cb-sem' });
    expect(ml.ok && ml.analysis).toMatchObject({
      method: 'cb-sem',
      engine: 'browser',
      estimator: 'ML',
      missingData: 'listwise',
      cb: { identification: 'marker', meanStructure: false },
    });
    expect(ml.ok && ml.analysis.bootstrap).toBeUndefined();
    const fiml = toConfiguration({
      ...defaultConfig(1),
      method: 'cb-sem',
      cbEstimator: 'MLR',
      identification: 'std-lv',
      cbMissing: 'fiml',
    });
    expect(fiml.ok && fiml.analysis).toMatchObject({
      estimator: 'MLR',
      missingData: 'fiml',
      cb: { identification: 'std-lv', meanStructure: true },
    });
  });

  it('runs a CB-SEM analysis locally and records the run with engine browser', async () => {
    const user = userEvent.setup();
    const { model, csv } = await loadFixtureCase('service-quality');
    useModeler.getState().newProject('CB');
    useDataLab.getState().clear();
    useModeler.getState().edit(() => model);
    await useDataLab
      .getState()
      .importText(csv, { name: 'sq', source: { kind: 'file', fileName: 'sq.csv' } });
    renderPage();
    await user.click(await screen.findByRole('radio', { name: /CB-SEM/ }));
    const run = screen.getByRole('button', { name: 'Run analysis' });
    await waitFor(() => expect(run).toBeEnabled());
    await user.click(run);
    expect(
      await screen.findByText('results page', undefined, { timeout: 30_000 }),
    ).toBeInTheDocument();
    const rec = useRuns.getState().runs[0];
    expect(rec?.record).toMatchObject({ status: 'complete', engine: 'browser', method: 'cb-sem' });
    expect(rec?.durationMs).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 60_000);
});

describe('running locally', () => {
  it('runs without any confirmation or network call, records a browser run with its duration', async () => {
    const user = userEvent.setup();
    setConfig({ repetitions: '40' });
    renderPage();
    const run = await screen.findByRole('button', { name: 'Run analysis' });
    await waitFor(() => expect(run).toBeEnabled());
    await user.click(run);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      await screen.findByText('results page', undefined, { timeout: 30_000 }),
    ).toBeInTheDocument();
    const rec = useRuns.getState().runs[0];
    expect(rec?.record).toMatchObject({ status: 'complete', engine: 'browser' });
    expect(rec?.record.result?.bootstrap?.requested).toBe(40);
    expect(rec?.durationMs).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 60_000);

  it('shows a determinate bar only with real counts, and Cancel stops the run with no result', async () => {
    const user = userEvent.setup();
    setConfig({ repetitions: '10000' });
    renderPage();
    const run = await screen.findByRole('button', { name: 'Run analysis' });
    await waitFor(() => expect(run).toBeEnabled());
    await user.click(run);
    const bar = await screen.findByRole('progressbar', undefined, { timeout: 30_000 });
    expect(bar).toHaveAttribute('aria-valuemax', '10000');
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeLessThan(10000);
    expect(
      screen.getByText(/bootstrap samples \(\d+ failed, \d+ inadmissible\)/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      await screen.findByText('Analysis cancelled', undefined, { timeout: 30_000 }),
    ).toBeInTheDocument();
    const rec = useRuns.getState().runs[0];
    expect(rec?.record.status).toBe('cancelled');
    expect(rec?.record.result).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    // the run history shows it as cancelled, with its measured duration column
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  }, 60_000);

  it('keeps Run disabled and calls no network when the data cannot be mapped', async () => {
    const { model } = await loadFixtureCase('pls-two-construct');
    useModeler.getState().newProject('bad');
    useDataLab.getState().clear();
    useModeler.getState().edit(() => model);
    await useDataLab
      .getState()
      .importText('a,b\n1,1\n1,1\n1,1', { name: 'x', source: { kind: 'file', fileName: 'x.csv' } });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Run analysis' })).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
