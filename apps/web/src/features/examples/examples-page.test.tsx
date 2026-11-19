import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RouterProvider } from 'react-router-dom';
import { createTestRouter } from '@/app/routes';
import { defaultConfig, useAnalysisConfig } from '@/features/analysis/config';
import { useDataLab } from '@/features/data-lab/store';
import { useModeler } from '@/features/modeler/store';
import { DB_NAME, resetDbForTests } from '@/storage/projects';
import { EXAMPLES } from './examples';

function renderApp() {
  const router = createTestRouter(['/examples']);
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset.theme = 'light';
  useModeler.getState().newProject('Test');
  useDataLab.getState().clear();
  useAnalysisConfig.setState({ config: defaultConfig(1) });
});

afterEach(async () => {
  resetDbForTests();
  await Dexie.delete(DB_NAME);
});

const card = (title: string) => screen.getByRole('group', { name: title });

describe('Examples page', () => {
  it('renders six cards with their badges, sizes and attribution', async () => {
    renderApp();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Examples & Colab' }),
    ).toBeVisible();
    expect(screen.getAllByRole('button', { name: /^Open example/ })).toHaveLength(6);

    const acsi = within(card(EXAMPLES.find((e) => e.id === 'acsi-2015')!.title));
    expect(acsi.getByText('PLS-SEM')).toBeVisible();
    expect(acsi.getByText('IPMA')).toBeVisible();
    expect(acsi.getByText('Bootstrap B = 1,000')).toBeVisible();
    expect(acsi.getByText('Real data · CC BY 4.0')).toBeVisible();
    expect(acsi.getByText(/8,239 rows/)).toBeVisible();
    expect(acsi.getByText(/Hult, Tomas; Morgeson/)).toBeVisible();
    expect(acsi.getByRole('link', { name: /CC BY 4.0 licence/ })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    );

    const sq = within(card(EXAMPLES.find((e) => e.id === 'service-quality')!.title));
    expect(sq.getByText('CB-SEM')).toBeVisible();
    expect(sq.getByText('Synthetic')).toBeVisible();
    expect(sq.queryByText(/Bootstrap/)).toBeNull();
    expect(sq.queryByText('IPMA')).toBeNull();

    expect(screen.getByRole('heading', { name: /Python notebooks/ })).toBeVisible();
    expect(screen.getByText(/reproduces the matching example above exactly/)).toBeVisible();
    // links point at the public repository's main branch (checked to resolve on GitHub)
    expect(
      within(screen.getByRole('region', { name: /Python notebooks/ })).getByRole('link'),
    ).toHaveAttribute('href', 'https://github.com/detinger/sem-studio/tree/main/notebooks');
    const tam = within(card(EXAMPLES.find((e) => e.id === 'tam-mediation')!.title));
    expect(tam.getByRole('link', { name: /Open in Colab/ })).toHaveAttribute(
      'href',
      'https://colab.research.google.com/github/detinger/sem-studio/blob/main/notebooks/colab/01_tam_pls_sem.ipynb',
    );
    expect(
      within(card(EXAMPLES.find((e) => e.id === 'acsi-2015')!.title)).queryByRole('link', {
        name: /Open in Colab/,
      }),
    ).toBeNull();
  });

  it('opens an example on an empty project: model, dataset, analysis settings, navigation', async () => {
    const user = userEvent.setup();
    const dm = EXAMPLES.find((e) => e.id === 'delone-mclean')!;
    const router = renderApp();
    await user.click(await screen.findByRole('button', { name: `Open example: ${dm.title}` }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/modeler'), {
      timeout: 15_000,
    });
    const m = useModeler.getState();
    expect(m.projectName).toBe(dm.title);
    expect(m.model).toEqual(dm.model);
    expect(Object.keys(m.layout.nodes).length).toBeGreaterThan(0);
    const lab = useDataLab.getState();
    expect(lab.dataset?.source).toEqual({ kind: 'bundled', exampleId: 'delone-mclean' });
    expect(m.datasetRef?.fingerprint).toBe(lab.dataset?.fingerprint);
    const cfg = useAnalysisConfig.getState().config;
    expect(cfg).toMatchObject({
      method: 'pls-sem',
      repetitions: String(dm.analysis.bootstrap?.repetitions),
      seed: String(dm.analysis.seed),
      ipmaTarget: dm.analysis.ipma?.targetConstructId,
      bootstrap: true,
    });
  }, 30_000);

  it('asks before replacing a non-empty project; Cancel changes nothing', async () => {
    const user = userEvent.setup();
    const dm = EXAMPLES.find((e) => e.id === 'tam-mediation')!;
    useModeler.getState().edit(() => dm.model);
    const before = useModeler.getState();
    const router = renderApp();
    await user.click(await screen.findByRole('button', { name: `Open example: ${dm.title}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Open this example?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const after = useModeler.getState();
    expect(after.projectId).toBe(before.projectId);
    expect(after.projectName).toBe('Test');
    expect(after.model).toBe(before.model);
    expect(useDataLab.getState().dataset).toBeNull();
    expect(useAnalysisConfig.getState().config).toEqual(defaultConfig(1));
    expect(router.state.location.pathname).toBe('/examples');
  });

  it('confirming creates a NEW project and leaves the old id alone', async () => {
    const user = userEvent.setup();
    const sq = EXAMPLES.find((e) => e.id === 'service-quality')!;
    useModeler.getState().edit(() => EXAMPLES[1]!.model);
    const oldId = useModeler.getState().projectId;
    const router = renderApp();
    await user.click(await screen.findByRole('button', { name: `Open example: ${sq.title}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Open this example?' });
    await user.click(within(dialog).getByRole('button', { name: 'Open example' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/modeler'), {
      timeout: 15_000,
    });
    expect(useModeler.getState().projectId).not.toBe(oldId);
    expect(useAnalysisConfig.getState().config.method).toBe('cb-sem');
  }, 30_000);

  it('opens an example with its saved layout exactly as arranged', async () => {
    const user = userEvent.setup();
    const ex = EXAMPLES.find((e) => e.id === 'acsi-inspired')!;
    expect(ex.layout).toBeDefined();
    const router = renderApp();
    await user.click(await screen.findByRole('button', { name: `Open example: ${ex.title}` }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/modeler'), {
      timeout: 15_000,
    });
    const nodes = useModeler.getState().layout.nodes;
    for (const [id, p] of Object.entries(ex.layout!.nodes))
      expect(nodes[id], id).toMatchObject({ x: p.x, y: p.y });
  }, 30_000);
});
