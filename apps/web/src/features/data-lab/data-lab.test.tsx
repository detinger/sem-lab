import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SemModel } from '@sem-lab/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACSI_ATTRIBUTION } from '@/domain/dataset/bundled';
import { addConstruct, addIndicators } from '@/domain/model-ops';
import { useModeler } from '@/features/modeler/store';
import { DB_NAME, resetDbForTests } from '@/storage/projects';
import { DataLabPage } from './DataLabPage';
import { useDataLab } from './store';

const FIXTURES = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'fixtures', 'synthetic');
const read = (path: string): string => readFileSync(join(FIXTURES, path), 'utf8');

const modeler = () => useModeler.getState();

beforeEach(() => {
  window.localStorage.clear();
  modeler().newProject('Test');
  useDataLab.getState().clear();
});

afterEach(async () => {
  resetDbForTests();
  await Dexie.delete(DB_NAME);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <DataLabPage />
    </MemoryRouter>,
  );
}

async function upload(csv: string, name = 'data.csv') {
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText('Choose CSV file'),
    new File([csv], name, { type: 'text/csv' }),
  );
  return user;
}

function modelWith(spec: Record<string, string[]>) {
  modeler().edit(() => {
    let m = SemModel.parse({ constructs: [], indicators: [], relationships: [] });
    for (const [name, inds] of Object.entries(spec)) {
      const r = addConstruct(m, { name });
      m = addIndicators(
        r.model,
        r.id,
        inds.map((n) => ({ name: n, column: null })),
      ).model;
    }
    return m;
  });
}

const columnOf = (name: string) => modeler().model.indicators.find((i) => i.name === name)?.column;

describe('import, preview and profile', () => {
  it('imports a small CSV through the file input and shows preview and profile', async () => {
    renderPage();
    await upload('a,b,c\n1,2,x\n3,4,y\n5,,z\n', 'small.csv');
    const preview = await screen.findByRole('region', { name: 'Preview of the working table' });
    expect(within(preview).getAllByRole('row')).toHaveLength(4);
    expect(within(preview).getAllByLabelText('missing value')).toHaveLength(1);
    const profile = screen.getByRole('region', { name: 'Column profiles' });
    expect(within(profile).getByText('a')).toBeInTheDocument();
    expect(within(profile).getAllByRole('img', { name: /Distribution of/ }).length).toBeGreaterThan(
      0,
    );
    // the project now points at the data, by fingerprint only
    const ds = useDataLab.getState().dataset!;
    expect(modeler().datasetRef?.fingerprint).toBe(ds.fingerprint);
    expect(JSON.stringify(modeler().toProject('2026-01-01T00:00:00.000Z'))).not.toContain('"rows"');
  });

  it('detects a decimal comma and re-parses with an override', async () => {
    renderPage();
    const user = await upload('a;b\n1,5;2,5\n2,5;3,5\n3,5;4,5\n');
    const issues = await screen.findByRole('list', { name: 'Import issues' });
    expect(within(issues).getByText(/was assumed/)).toBeInTheDocument();
    expect(useDataLab.getState().profiles.map((p) => p.kind)).toEqual(['numeric', 'numeric']);

    await user.selectOptions(screen.getByLabelText('Decimal mark'), '.');
    await user.click(screen.getByRole('button', { name: /Re-parse/ }));
    await waitFor(() =>
      expect(useDataLab.getState().profiles.map((p) => p.kind)).toEqual(['text', 'text']),
    );
  });

  it('flags a text column with its offending examples and count', async () => {
    renderPage();
    await upload('q1,q2\n1,2\n2,abc\n3,xyz\n4,5\n5,6\n6,7\n');
    const profile = await screen.findByRole('region', { name: 'Column profiles' });
    expect(
      within(profile).getByText(/2 non-numeric values, e\.g\. “abc”, “xyz”/),
    ).toBeInTheDocument();
    expect(within(profile).getByText('text')).toBeInTheDocument();
  });

  it('blocks a file with errors and says why', async () => {
    renderPage();
    await upload('');
    expect(await screen.findByText('The data could not be imported')).toBeInTheDocument();
    expect(useDataLab.getState().dataset).toBeNull();
  });

  it('applies a transformation to a copy and logs it; the original stays', async () => {
    renderPage();
    const user = await upload('a,b\n1,2\n2,3\n3,4\n4,5\n');
    await screen.findByRole('region', { name: 'Preview of the working table' });
    await user.type(screen.getByLabelText('Scale minimum'), '1');
    await user.type(screen.getByLabelText('Scale maximum'), '5');
    await user.click(screen.getByRole('button', { name: 'Add transformation' }));
    const log = await screen.findByRole('list', { name: 'Transformation log' });
    expect(
      within(log).getByText(/Reverse-score a \(scale 1–5\) into a_rev/, {
        selector: '.dl-log__text',
      }),
    ).toBeInTheDocument();
    const ds = useDataLab.getState().dataset!;
    expect(ds.columns.map((c) => c.name)).toEqual(['a', 'b', 'a_rev']);
    expect(ds.original.columns).toEqual(['a', 'b']);
    await user.click(screen.getByRole('button', { name: 'Undo last step' }));
    await waitFor(() => expect(useDataLab.getState().dataset!.columns).toHaveLength(2));
  });
});

describe('sample datasets', () => {
  it('loads a synthetic dataset and labels it SYNTHETIC', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Use sample dataset/ }));
    await user.click(screen.getByRole('menuitem', { name: /TAM mediation \(PEOU/ }));
    const heading = await screen.findByRole(
      'heading',
      { name: /TAM mediation/ },
      { timeout: 8000 },
    );
    const card = heading.closest('.dl-card') as HTMLElement;
    expect(within(card).getByText('SYNTHETIC')).toBeInTheDocument();
    expect(within(card).getByText(/represent(s)? no real study/)).toBeInTheDocument();
  });

  it('shows the ACSI attribution where it is offered and when it is used', async () => {
    renderPage();
    expect(screen.getByText(ACSI_ATTRIBUTION, { exact: false })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Use sample dataset/ }));
    expect(
      screen.getByRole('menuitem', { name: /American Customer.*CC BY 4\.0/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /American Customer/ }));
    const heading = await screen.findByRole(
      'heading',
      { name: /American Customer/ },
      { timeout: 20000 },
    );
    const card = heading.closest('.dl-card') as HTMLElement;
    expect(within(card).getByText(/CC BY 4\.0/, { selector: 'a' })).toBeInTheDocument();
    expect(within(card).getByText(/Hult, Tomas/, { exact: false })).toBeInTheDocument();
  }, 30000);
});

describe('mapping', () => {
  it('Apply suggestions binds unambiguous matches and leaves ambiguous ones', async () => {
    modelWith({ PU: ['pu1', 'PU2', 'x_3', 'AMB'] });
    renderPage();
    const user = await upload('pu1,pu2,x3,amb,Amb\n1,2,3,4,5\n2,3,4,5,6\n3,4,5,6,7\n');
    await screen.findByRole('button', { name: /Apply suggestions \(3\)/ });
    await user.click(screen.getByRole('button', { name: /Apply suggestions/ }));
    expect(columnOf('pu1')).toBe('pu1');
    expect(columnOf('PU2')).toBe('pu2');
    expect(columnOf('x_3')).toBe('x3');
    expect(columnOf('AMB') ?? null).toBeNull();
    // match badges tell exact from suggested
    expect(screen.getAllByText('exact').length).toBeGreaterThan(0);
    expect(screen.getAllByText('suggested').length).toBeGreaterThan(0);
  });

  it('editing scale endpoints is one undoable step, also in bulk', async () => {
    modelWith({ PU: ['pu1', 'pu2'] });
    renderPage();
    const user = userEvent.setup();
    const scaleOf = (n: string) => modeler().model.indicators.find((i) => i.name === n)?.scale;
    const before = modeler().past.length;
    await user.type(screen.getByLabelText('pu1 scale minimum'), '1');
    await user.type(screen.getByLabelText('pu1 scale maximum'), '7');
    await user.tab();
    expect(scaleOf('pu1')).toEqual({ min: 1, max: 7 });
    expect(modeler().past.length).toBe(before + 1);
    modeler().undo();
    expect(scaleOf('pu1')).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Set 1–7 for all indicators of PU' }));
    expect(scaleOf('pu1')).toEqual({ min: 1, max: 7 });
    expect(scaleOf('pu2')).toEqual({ min: 1, max: 7 });
    modeler().undo();
    expect(scaleOf('pu1')).toBeUndefined();
    expect(scaleOf('pu2')).toBeUndefined();
  });

  it('highlights observed values outside the declared endpoints', async () => {
    modelWith({ PU: ['pu1'] });
    renderPage();
    const user = await upload('pu1\n1\n2\n9\n4\n');
    await screen.findByRole('region', { name: 'Preview of the working table' });
    await user.click(screen.getByRole('button', { name: 'Apply suggestions (1)' }));
    await user.type(screen.getByLabelText('pu1 scale minimum'), '1');
    await user.type(screen.getByLabelText('pu1 scale maximum'), '7');
    await user.tab();
    expect(await screen.findByText(/observed 1–9, outside 1–7/)).toBeInTheDocument();
    expect(screen.getByLabelText('pu1 scale maximum')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the scale-endpoint callout while endpoints are missing', () => {
    modelWith({ PU: ['pu1'] });
    renderPage();
    expect(
      screen.getByText(
        /Set the permitted minimum and maximum of the original response scale for each indicator/,
      ),
    ).toBeInTheDocument();
  });
});

describe('validation and project link', () => {
  it('a broken mapping names the missing columns and blocks analysis', async () => {
    modeler().edit(() => SemModel.parse(JSON.parse(read('broken-mapping/model.json'))));
    renderPage();
    await upload(read('tam-mediation/data.csv'), 'tam.csv');
    const row = await screen.findByText(/Columns not in the dataset: pu5, bi_4/);
    expect(row).toBeInTheDocument();
    expect(screen.getByText(/analysis is blocked while errors remain/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show in mapping' })).toBeInTheDocument();
  });

  it('verifies the fingerprint when the project data are imported again', async () => {
    const csv = 'a,b\n1,2\n2,3\n3,5\n4,4\n';
    renderPage();
    await upload(csv);
    await waitFor(() => expect(modeler().datasetRef).toBeDefined());
    const ref = modeler().datasetRef!;

    // a different browser: the project carries the ref, the data are not stored here
    useDataLab.getState().clear();
    resetDbForTests();
    await Dexie.delete(DB_NAME);
    await useDataLab.getState().restoreFor(ref);
    expect(
      await screen.findByText(/is not stored in this browser — import the same file again/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`fingerprint ${ref.fingerprint.slice(0, 12)}`)),
    ).toBeInTheDocument();

    // a changed file is flagged, and the project keeps its original link
    await upload('a,b\n1,2\n2,3\n3,5\n4,9\n');
    expect(
      await screen.findByText(/differ from the data this project was built on/),
    ).toBeInTheDocument();
    expect(modeler().datasetRef?.fingerprint).toBe(ref.fingerprint);

    // the original file is verified
    await upload(csv);
    expect(await screen.findByText('Matches project')).toBeInTheDocument();
  });

  it('finds the stored dataset again by fingerprint', async () => {
    renderPage();
    await upload('a,b\n1,2\n2,3\n3,5\n4,4\n');
    await waitFor(() => expect(modeler().datasetRef).toBeDefined());
    const ref = modeler().datasetRef!;
    useDataLab.getState().clear();
    await useDataLab.getState().restoreFor(ref);
    expect(useDataLab.getState().dataset?.fingerprint).toBe(ref.fingerprint);
  });
});

describe('privacy', () => {
  it('never writes cell values to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    renderPage();
    await upload('q1,q2\n1,SECRETCELLVALUE\n2,SECRETCELLVALUE\n3,4\n');
    await screen.findByRole('region', { name: 'Column profiles' });
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls.map((c) => c.map(String))));
    expect(logged).not.toContain('SECRETCELLVALUE');
    expect(window.location.href).not.toContain('SECRET');
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('SECRET');
  });
});
