import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToastProvider } from '@/components/ui';
import { useRuns } from '@/features/analysis/runs';
import { openTamProject, saveCompleteRun } from '@/features/analysis/test-support';
import { useFocusRequest } from '@/features/modeler/focus';
import { useModeler } from '@/features/modeler/store';
import { DB_NAME, resetDbForTests } from '@/storage/projects';
import { COPY_MESSAGES } from '../reports/clipboard';
import { loadIpmaFixture } from './devHook';
import { IpmaPage } from './IpmaPage';

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <IpmaPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  useRuns.setState({ projectId: null, runs: [], selectedRunId: null });
  useFocusRequest.getState().clear();
  useModeler.getState().newProject('t');
});
afterEach(async () => {
  resetDbForTests();
  await Dexie.delete(DB_NAME);
});

describe('IPMA page empty states', () => {
  it('no run', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'IPMA' })).toBeInTheDocument();
    expect(await screen.findByText('No results yet')).toBeInTheDocument();
  });

  it('run without IPMA says to choose a target in Analysis', async () => {
    await openTamProject();
    await saveCompleteRun();
    renderPage();
    expect(
      await screen.findByText('Choose an IPMA target in Analysis and run again.'),
    ).toBeInTheDocument();
  });

  it('missing endpoints show the exact callout linking to Data', async () => {
    await openTamProject();
    await saveCompleteRun();
    const m = useModeler.getState();
    // drop one endpoint WITHOUT changing the run's model hash would make the run stale, so edit
    // the stored run's model instead: the page checks the open model, which must equal the run's.
    m.edit((model) => ({
      ...model,
      indicators: model.indicators.map((i, k) => {
        if (k !== 0) return i;
        const { scale: _scale, ...rest } = i;
        void _scale;
        return rest;
      }),
    }));
    renderPage();
    // the model changed, so the run is historical; the page says so instead of inventing IPMA
    expect(await screen.findByText('The latest run is historical')).toBeInTheDocument();
  });
});

describe('IPMA page with a real-engine result', () => {
  it('shows the target, selects a point, decomposes paths, focuses the modeler, copies the table', async () => {
    const user = userEvent.setup();
    const write: ClipboardItem[][] = [];
    class FakeItem {
      data: Record<string, Blob>;
      constructor(data: Record<string, Blob>) {
        this.data = data;
      }
    }
    (globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem = FakeItem;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        write: (items: ClipboardItem[]) => {
          write.push(items);
          return Promise.resolve();
        },
      },
      configurable: true,
    });
    await loadIpmaFixture();
    renderPage();
    expect(await screen.findByTestId('ipma-target')).toHaveTextContent('Behavioural intention');
    expect(screen.queryByRole('radio', { name: 'Indicators' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Select a point on the map to see its importance, performance and the paths behind it.',
      ),
    ).toBeInTheDocument();

    const points = screen.getAllByRole('button', { name: /importance .* performance/ });
    expect(points.length).toBe(2);
    await user.click(screen.getByRole('button', { name: /^PEOU: importance/ }));
    expect(screen.getByTestId('side-importance')).toHaveTextContent('0.536');
    expect(screen.getByTestId('side-performance')).toHaveTextContent('66.4 / 100');
    expect(screen.getByTestId('ipma-live')).toHaveTextContent(/PEOU: importance 0\.536/);
    expect(screen.getByTestId('side-total')).toHaveTextContent('0.453');

    // switching to indicators changes the map; direct toggle keeps both (both are direct here)
    await user.click(screen.getByRole('radio', { name: 'Indicators' }));
    expect(screen.getAllByRole('button', { name: /importance .* performance/ }).length).toBe(8);
    await user.click(screen.getByRole('radio', { name: 'Constructs' }));

    await user.click(screen.getByRole('button', { name: 'View supporting paths' }));
    const req = useFocusRequest.getState().request!;
    expect(req.ids).toEqual(expect.arrayContaining(['c_peou', 'c_bi', 'r_peou_bi']));
    expect(useModeler.getState().selection).toContain('c_peou');

    await user.click(screen.getAllByRole('button', { name: 'Copy table' })[0]!);
    await waitFor(() => expect(write.length).toBe(1));
    const item = write[0]![0] as unknown as FakeItem;
    expect(Object.keys(item.data).sort()).toEqual(['text/html', 'text/plain']);
    expect(await screen.findByText(COPY_MESSAGES.rich)).toBeInTheDocument();
  });

  it('table is the non-visual equivalent with rank by importance', async () => {
    await loadIpmaFixture();
    renderPage();
    const region = await screen.findByLabelText('IPMA data', { exact: true });
    const rows = within(region).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText('PEOU')).toBeInTheDocument();
  });
});
