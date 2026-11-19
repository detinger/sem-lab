import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui';
import { useDataLab } from '@/features/data-lab/store';
import { useModeler } from '@/features/modeler/store';
import { DB_NAME, resetDbForTests } from '@/storage/projects';
import { type Health, type JobStatus, api } from './api';
import { AnalysisPage } from './AnalysisPage';
import { useAnalysisConfig, defaultConfig } from './config';
import { useJobs } from './jobs';
import { useRuns } from './runs';
import { FIXTURE_RESULT, openTamProject } from './test-support';

vi.mock('./api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  API_BASE_URL: 'https://api.example.test',
}));

const HEALTH: Health = {
  status: 'ok',
  version: '1',
  engines: [{ id: 'r-csem', available: true, version: '0.7.1', jobs: true }],
  limits: {
    maxCsvMb: 25,
    maxRows: 1000,
    maxColumns: 500,
    maxBootstrapReps: 10000,
    maxConcurrentJobs: 2,
    jobTimeoutSeconds: 1800,
    dataRetentionHours: 24,
  },
};

const status = (over: Partial<JobStatus>): JobStatus => ({
  id: 'job-1',
  status: 'estimating',
  stage: 'estimating',
  done: null,
  total: null,
  failed: null,
  inadmissible: null,
  warnings: [],
  error: null,
  engine: 'r-csem',
  createdAt: '',
  updatedAt: '',
  finishedAt: null,
  ...over,
});

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

beforeEach(async () => {
  window.localStorage.clear();
  vi.spyOn(api, 'health').mockResolvedValue(HEALTH);
  useAnalysisConfig.setState({ config: defaultConfig(42) });
  useJobs.setState({ active: null, outcome: null, remoteConfirmed: false, intervalMs: 5 });
  useRuns.setState({ projectId: null, runs: [], selectedRunId: null });
  await openTamProject();
});

afterEach(async () => {
  resetDbForTests();
  await Dexie.delete(DB_NAME);
});

describe('configuration', () => {
  it('gates options by the registry: BCa disabled with the reason, centroid enabled', async () => {
    renderPage();
    const bca = await screen.findByRole('option', { name: /BCa/ });
    expect(bca).toBeDisabled();
    expect(screen.getByText(/BCa unavailable: .*not yet checked/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Centroid' })).toBeEnabled();
    const cb = screen.getByRole('radio', { name: /CB-SEM/ });
    expect(cb).toBeDisabled();
    expect(
      within(cb).getByText(
        /arrives in a later release \(lavaan engine verified, adapter pending\)/,
      ),
    ).toBeInTheDocument();
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

describe('running', () => {
  it('asks for confirmation once, polls, shows stage and a determinate bar only with done/total', async () => {
    const user = userEvent.setup();
    let current = status({ status: 'estimating', stage: 'estimating' });
    const submit = vi.spyOn(api, 'submitJob').mockResolvedValue({ id: 'job-1' });
    vi.spyOn(api, 'status').mockImplementation(() => Promise.resolve(current));
    vi.spyOn(api, 'result').mockResolvedValue(FIXTURE_RESULT);
    renderPage();
    const run = await screen.findByRole('button', { name: 'Run analysis' });
    await waitFor(() => expect(run).toBeEnabled());
    await user.click(run);

    const dialog = await screen.findByRole('dialog', { name: /Data leaves your browser/ });
    expect(within(dialog).getByText('api.example.test')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Up to 24 hours');
    expect(dialog).toHaveTextContent('Delete uploaded data');
    expect(submit).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Send data and run' }));

    expect((await screen.findAllByText('Estimating the model')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(1);

    current = status({
      status: 'bootstrapping',
      stage: 'bootstrapping',
      done: 200,
      total: 1000,
      failed: 1,
      inadmissible: 2,
    });
    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '200');
    expect(bar).toHaveAttribute('aria-valuemax', '1000');
    expect(
      screen.getByText('200 of 1,000 bootstrap samples (1 failed, 2 inadmissible)'),
    ).toBeInTheDocument();

    current = status({ status: 'complete', stage: null, finishedAt: 'x' });
    expect(await screen.findByText('results page')).toBeInTheDocument();
    expect(useRuns.getState().runs[0]?.record.status).toBe('complete');
    expect(useJobs.getState().remoteConfirmed).toBe(true);
  });

  it('does not ask again in the same session', async () => {
    const user = userEvent.setup();
    useJobs.setState({ remoteConfirmed: true });
    const submit = vi.spyOn(api, 'submitJob').mockResolvedValue({ id: 'job-1' });
    vi.spyOn(api, 'status').mockResolvedValue(
      status({
        status: 'failed',
        error: { code: 'ENGINE_NONCONVERGENCE', message: 'did not converge' },
      }),
    );
    renderPage();
    const run = await screen.findByRole('button', { name: 'Run analysis' });
    await waitFor(() => expect(run).toBeEnabled());
    await user.click(run);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    // failed job: code, message and a fix hint
    const failure = await screen.findByRole('region', { name: 'Analysis failed' });
    expect(failure).toHaveTextContent('ENGINE_NONCONVERGENCE');
    expect(failure).toHaveTextContent('did not converge');
    expect(failure).toHaveTextContent(/Raise the maximum iterations/);
    await user.click(within(failure).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run analysis' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  });

  it('cancel calls api.cancel', async () => {
    const user = userEvent.setup();
    useJobs.setState({ remoteConfirmed: true });
    vi.spyOn(api, 'submitJob').mockResolvedValue({ id: 'job-1' });
    vi.spyOn(api, 'status').mockResolvedValue(
      status({ status: 'bootstrapping', stage: 'bootstrapping' }),
    );
    const cancel = vi.spyOn(api, 'cancel').mockResolvedValue({});
    renderPage();
    const run = await screen.findByRole('button', { name: 'Run analysis' });
    await waitFor(() => expect(run).toBeEnabled());
    await user.click(run);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledWith('job-1');
    useDataLab.getState().clear();
  });
});
