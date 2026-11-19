import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui';
import { useRuns } from '@/features/analysis/runs';
import { cbFixture, openCbProjectWithRun } from '@/features/analysis/test-support';
import { DB_NAME, resetDbForTests } from '@/storage/projects';
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

beforeEach(() => {
  window.localStorage.clear();
  useRuns.setState({ projectId: null, runs: [], selectedRunId: null });
  useResultStyle.setState({
    decimals: 3,
    apa: false,
    scale: 'standardized',
    includeCaption: true,
    includeNotes: true,
  });
});

afterEach(async () => {
  resetDbForTests();
  await Dexie.delete(DB_NAME);
  vi.unstubAllGlobals();
});

describe('Results page for a CB-SEM run', () => {
  it('names the engine and package version, and has no Bootstrap tab', async () => {
    await openCbProjectWithRun('cb-service-quality-ml', 'service-quality');
    renderPage();
    const prov = await screen.findByLabelText('Run provenance');
    expect(prov).toHaveTextContent(
      /CB-SEM, ML, marker, listwise.*SEM Lab engine \(in browser\), @sem-lab\/engine 0\.1\.0.*analytic standard errors/,
    );
    expect(prov).toHaveTextContent(/120 ms on this device/);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Summary', 'Fit', 'Measurement', 'Structural', 'Reproducibility']);
  });

  it('shows the fit table with the labelled indices', async () => {
    const user = userEvent.setup();
    await openCbProjectWithRun('cb-service-quality-mlr', 'service-quality');
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Fit' }));
    const table = screen.getByRole('group', { name: 'Model fit' });
    for (const label of ['χ²', 'CFI (robust)', 'RMSEA (scaled) [90% CI]', 'SRMR', 'AIC', 'BIC'])
      expect(within(table).getByText(label)).toBeInTheDocument();
  });

  it('the Standardized / Unstandardized toggle changes labels, legend and values', async () => {
    const user = userEvent.setup();
    const fx = cbFixture('cb-service-quality-ml');
    await openCbProjectWithRun('cb-service-quality-ml', 'service-quality');
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Structural' }));
    const paths = () => screen.getByRole('group', { name: /Structural paths/ });
    expect(paths()).toHaveTextContent('Structural paths (standardized)');
    expect(within(paths()).getByText('β (standardized)')).toBeInTheDocument();
    expect(
      screen.getByText(/Showing standardized estimates \(lavaan std\.all\)/),
    ).toBeInTheDocument();
    const std = fx.result.parameters.find(
      (p) => p.key === 'path:c_sq->c_sat' && p.scale === 'standardized',
    )!;
    expect(within(paths()).getByText(std.est!.toFixed(3))).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Unstandardized' }));
    expect(paths()).toHaveTextContent('Structural paths (unstandardized)');
    expect(within(paths()).getByText('B (unstandardized)')).toBeInTheDocument();
    expect(screen.getByText(/Showing unstandardized estimates/)).toBeInTheDocument();
    const un = fx.result.parameters.find(
      (p) => p.key === 'path:c_sq->c_sat' && p.scale === 'unstandardized',
    )!;
    expect(within(paths()).getByText(un.est!.toFixed(3))).toBeInTheDocument();
    expect(within(paths()).getByText(un.se!.toFixed(3))).toBeInTheDocument();
  });

  it('states a Heywood case prominently but neutrally', async () => {
    await openCbProjectWithRun('cb-heywood', 'cb-heywood-exact');
    renderPage();
    const note = await screen.findByText('The solution is not admissible');
    expect(note).toBeInTheDocument();
    expect(screen.getByText(/never clamped|not clamped/)).toBeInTheDocument();
    expect(screen.getByText(/Heywood case/, { selector: 'li' })).toBeInTheDocument();
  });

  it('exports the lavaan script and the analysis data for a CB run', async () => {
    const user = userEvent.setup();
    await openCbProjectWithRun('cb-service-quality-ml', 'service-quality');
    const files: Array<{ name: string; text: Promise<string> }> = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: (b: Blob) => {
          files.push({ name: '', text: b.text() });
          return `blob:${files.length}`;
        },
        revokeObjectURL: () => undefined,
      }),
    );
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Reproducibility' }));
    const button = screen.getByRole('button', { name: 'Export R script' });
    expect(button).toBeEnabled();
    expect(screen.queryByText(/arrives with the lavaan adapter/)).not.toBeInTheDocument();
    await user.click(button);
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(names).toEqual(['CB-test-R-export.zip']);
    // stored (uncompressed) ZIP: entry names and text are readable in the bytes
    const zipText = await files[0]!.text;
    expect(zipText.startsWith('PK\u0003\u0004')).toBe(true);
    for (const f of [
      'lavaan.R',
      'analysis-data.csv',
      'manifest.json',
      'README.md',
      'browser-result.json',
    ])
      expect(zipText).toContain(f);
    expect(zipText).toContain('estimator = "ML"');
    expect(zipText).toContain('lavaan');
    expect(zipText).toContain('sq1,sq2,sq3,sq4,sq5,sat1,sat2,sat3,sat4,loy1,loy2,loy3,loy4\n');
  });

  it('disables the export with the reason for an estimator the lavaan export does not cover', async () => {
    const run = await openCbProjectWithRun('cb-service-quality-ml', 'service-quality');
    void run;
    const { cbExportBlock } = await import('./ExportR');
    const view = (estimator: string, measurement: 'reflective' | 'composite-formative') => ({
      ...run,
      staleness: 'current' as const,
      model: {
        ...run.model,
        constructs: run.model.constructs.map((c, i) => (i === 0 ? { ...c, measurement } : c)),
      },
      record: { ...run.record, options: { ...run.record.options, estimator } },
    });
    expect(cbExportBlock(view('ML', 'reflective'))).toBeNull();
    expect(cbExportBlock(view('MLM', 'reflective'))).toMatch(
      /covers ML and MLR only; this run used MLM/,
    );
    expect(cbExportBlock(view('ML', 'composite-formative'))).toMatch(/reflective constructs only/);
  });
});
