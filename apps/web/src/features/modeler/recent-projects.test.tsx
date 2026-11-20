import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SemProject } from '@sem-lab/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestRouter } from '@/app/routes';
import { useDataLab } from '@/features/data-lab/store';
import { DB_NAME, getDb, listProjects, resetDbForTests, saveProject } from '@/storage/projects';

import { useModeler } from './store';
import { LAST_PROJECT_KEY } from './useAutosave';

const example = SemProject.parse(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        'packages',
        'contracts',
        'examples',
        'valid',
        'project.tam-v1.json',
      ),
      'utf8',
    ),
  ),
);

function renderOverview() {
  const router = createTestRouter(['/']);
  render(<RouterProvider router={router} />);
  return router;
}

const list = () => screen.findByRole('list', { name: 'Saved projects' });

beforeEach(async () => {
  window.localStorage.clear();
  document.documentElement.dataset.theme = 'light';
  useModeler.getState().newProject('Untitled model');
  await saveProject({
    ...example,
    id: 'p_old',
    name: 'Older model',
    updatedAt: '2026-01-01T09:00:00Z',
  });
  await saveProject({
    ...example,
    id: 'p_new',
    name: 'Newer model',
    updatedAt: '2026-06-01T09:00:00Z',
  });
});

afterEach(async () => {
  resetDbForTests();
  await Dexie.delete(DB_NAME);
});

describe('Overview recent projects', () => {
  it('lists saved projects newest first with their size and edit time', async () => {
    renderOverview();
    const rows = within(await list()).getAllByRole('listitem');
    expect(rows.map((r) => within(r).getAllByRole('button')[0]!.textContent)).toEqual([
      expect.stringContaining('Newer model'),
      expect.stringContaining('Older model'),
    ]);
    expect(rows[0]!).toHaveTextContent('5 constructs · 22 indicators · Edited 1 Jun 2026');
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument();
  });

  it('opens a project in the Modeler and remembers it as the last project', async () => {
    const user = userEvent.setup();
    const router = renderOverview();
    await user.click(within(await list()).getByRole('button', { name: /^Older model/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/modeler'), {
      timeout: 15_000,
    });
    expect(useModeler.getState().projectId).toBe('p_old');
    expect(useModeler.getState().projectName).toBe('Older model');
    expect(window.localStorage.getItem(LAST_PROJECT_KEY)).toBe('p_old');
  });

  it('marks the project that is open in the Modeler', async () => {
    useModeler.getState().load({ ...example, id: 'p_new', name: 'Newer model' });
    renderOverview();
    const rows = within(await list()).getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Open')).toBeInTheDocument();
    expect(within(rows[1]!).queryByText('Open')).not.toBeInTheDocument();
  });

  it('deletes after confirmation and clears the Modeler if that project was open', async () => {
    const user = userEvent.setup();
    useModeler.getState().load({ ...example, id: 'p_new', name: 'Newer model' });
    window.localStorage.setItem(LAST_PROJECT_KEY, 'p_new');
    renderOverview();
    await user.click(within(await list()).getByRole('button', { name: 'Delete Newer model' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete “Newer model”?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Saved projects' })).getAllByRole('listitem'),
      ).toHaveLength(1),
    );
    expect((await listProjects()).map((p) => p.id)).toEqual(['p_old']);
    expect(useModeler.getState().projectId).not.toBe('p_new');
    expect(useModeler.getState().model.constructs).toHaveLength(0);
    expect(window.localStorage.getItem(LAST_PROJECT_KEY)).toBeNull();
  });

  it('Clear all removes projects, datasets and runs but keeps learning progress', async () => {
    const user = userEvent.setup();
    const db = getDb();
    await db.runs.put({
      runId: 'r1',
      projectId: 'p_new',
      createdAt: '2026-06-01T09:00:00Z',
    } as never);
    await db.skills.put({ skill: 's1' } as never);
    useModeler.getState().load({ ...example, id: 'p_new', name: 'Newer model' });
    window.localStorage.setItem(LAST_PROJECT_KEY, 'p_new');
    renderOverview();
    await list();
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    const dialog = await screen.findByRole('dialog', { name: 'Clear all projects and data?' });
    await user.click(within(dialog).getByRole('button', { name: 'Clear all' }));

    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
    expect(await db.projects.count()).toBe(0);
    expect(await db.runs.count()).toBe(0);
    expect(await db.datasets.count()).toBe(0);
    expect(await db.skills.count()).toBe(1);
    expect(useModeler.getState().model.constructs).toHaveLength(0);
    expect(useDataLab.getState().dataset).toBeNull();
    expect(window.localStorage.getItem(LAST_PROJECT_KEY)).toBeNull();
  });

  it('shows the empty state when nothing is saved', async () => {
    resetDbForTests();
    await Dexie.delete(DB_NAME);
    renderOverview();
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
  });
});
