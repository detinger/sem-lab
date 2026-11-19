import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui';
import { updateConstruct } from '@/domain/model-ops';
import { useRuns } from '@/features/analysis/runs';
import { openTamProject, saveCompleteRun, TAM_MODEL } from '@/features/analysis/test-support';
import { useModeler } from '@/features/modeler/store';
import { DB_NAME, resetDbForTests } from '@/storage/projects';
import { COPY_MESSAGES } from '../reports/clipboard';
import { ResultsPage } from './ResultsPage';
import { useResultStyle } from './store';

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <ResultsPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  useRuns.setState({ projectId: null, runs: [], selectedRunId: null });
  useResultStyle.setState({ decimals: 3, apa: false, includeCaption: true, includeNotes: true });
  await openTamProject();
  await saveCompleteRun();
});

afterEach(async () => {
  resetDbForTests();
  await Dexie.delete(DB_NAME);
});

describe('Results page', () => {
  it('renders the provenance line and every tab from the fixture result', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByLabelText('Run provenance')).toHaveTextContent(
      /PLS-SEM, path weighting · r-csem \(cSEM 0\.7\.1\) · N = 500 .* seed 20261119, B = 200 \(200 valid, 0 failed, 0 inadmissible\)/,
    );
    const tab = (n: string) => screen.getByRole('tab', { name: n });
    expect(screen.getByText('Valid bootstrap draws')).toBeInTheDocument();

    await user.click(tab('Measurement'));
    for (const t of ['Outer loadings and weights', 'Reliability and convergent validity'])
      expect(screen.getByRole('heading', { name: t })).toBeInTheDocument();
    expect(screen.getAllByText(/HTMT/).length).toBeGreaterThan(0);

    await user.click(tab('Structural'));
    expect(screen.getByRole('heading', { name: 'Path coefficients' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Total and indirect effects' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Explained variance' })).toBeInTheDocument();
    expect(screen.getAllByText('What it does not show.').length).toBeGreaterThan(0);

    await user.click(tab('Bootstrap'));
    expect(
      screen.getByRole('img', { name: /Histogram of 200 bootstrap estimates/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Number of draws')).toBeInTheDocument();
    expect(screen.getByText('Data table of the histogram')).toBeInTheDocument();

    await user.click(tab('Fit'));
    expect(screen.getByRole('heading', { name: 'Model fit' })).toBeInTheDocument();
    expect(screen.getByText('SRMR')).toBeInTheDocument();

    await user.click(tab('Reproducibility'));
    expect(screen.getByRole('button', { name: 'Export R script' })).toBeEnabled();
    expect(screen.getByText(/Both are verified by automated tests/)).toBeInTheDocument();
  });

  it('applies decimals and APA style to every table', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Structural' }));
    const paths = screen.getByRole('region', { name: 'Path coefficients' });
    const before = within(paths).getAllByRole('row')[1]!.textContent;
    expect(before).toMatch(/0\.\d{3}/);
    await user.click(screen.getByRole('radio', { name: '2 decimals' }));
    expect(
      within(screen.getByRole('region', { name: 'Path coefficients' })).getAllByRole('row')[1]!
        .textContent,
    ).toMatch(/0\.\d{2}(?!\d)/);
    await user.click(screen.getByRole('switch', { name: /APA style/ }));
    expect(
      within(screen.getByRole('region', { name: 'Path coefficients' })).getAllByRole('row')[1]!
        .textContent,
    ).toMatch(/[^0-9]\.\d{2}/);
  });

  it('Copy table writes text/html and text/plain and says so', async () => {
    const user = userEvent.setup();
    const written: Array<Record<string, Blob>> = [];
    class FakeItem {
      constructor(data: Record<string, Blob>) {
        written.push(data);
      }
    }
    vi.stubGlobal('ClipboardItem', FakeItem);
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Structural' }));
    const paths = screen.getByRole('region', { name: 'Path coefficients' });
    // the section containing the toolbar
    const section = paths.closest('[role=group]') as HTMLElement;
    await user.click(within(section).getByRole('button', { name: 'Copy table' }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(Object.keys(written[0]!).sort()).toEqual(['text/html', 'text/plain']);
    expect(written[0]!['text/html']!.type).toBe('text/html');
    expect(await screen.findByText(COPY_MESSAGES.rich)).toBeInTheDocument();
  });

  it('labels a run as historical when the model changed since it ran', async () => {
    useModeler
      .getState()
      .edit((m) => updateConstruct(m, TAM_MODEL.constructs[0]!.id, { name: 'Renamed' }));
    renderPage();
    expect(await screen.findByText('Historical run')).toBeInTheDocument();
    expect(
      screen.getAllByText(/historical \(model changed since this run\)/).length,
    ).toBeGreaterThan(0);
    // still shows the names of the model as submitted
    expect(screen.queryByText('Renamed')).not.toBeInTheDocument();
  });

  it('Export R script and Export Python script each download one ZIP bundle', async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      blobs.push(b as Blob);
      return `blob:${blobs.length}`;
    });
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    const text = (b: Blob) =>
      new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.readAsText(b);
      });
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Reproducibility' }));
    await user.click(screen.getByRole('button', { name: 'Export R script' }));
    await waitFor(() => expect(names).toHaveLength(1));
    expect(names[0]).toBe('TAM-test-R-export.zip');
    const r = await text(blobs[0]!);
    expect(r).toContain('TAM-test/TAM-test-cSEM.R');
    expect(r).toContain('.disattenuate = FALSE');
    expect(r).toContain('TAM-test/manifest.json');

    await user.click(screen.getByRole('button', { name: 'Export Python script' }));
    await waitFor(() => expect(names).toHaveLength(2), { timeout: 5000 });
    expect(names[1]).toBe('TAM-test-Python-export.zip');
    const py = await text(blobs[1]!);
    for (const f of ['run_analysis.py', 'semstudio_bundle.py', 'requirements.txt', 'analysis.json'])
      expect(py).toContain(`TAM-test/${f}`);
  });
});
