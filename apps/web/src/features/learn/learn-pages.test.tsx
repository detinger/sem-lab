import 'fake-indexeddb/auto';
import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestRouter } from '@/app/routes';
import { defaultConfig, useAnalysisConfig } from '@/features/analysis/config';
import { useDataLab } from '@/features/data-lab/store';
import { useModeler } from '@/features/modeler/store';
import { listLessonProgress } from '@/storage/learn';
import { DB_NAME, resetDbForTests } from '@/storage/projects';
import { fixtureContent, tamModel } from './__fixtures__/content';
import { ACTIVE_CHALLENGE_KEY, useActiveChallenge } from './active';
import { useContent } from './content';
import { useProgress } from './progress';
import { useWorkspace } from './workspace';

// The pages and the challenge dock are lazy-loaded; under a full parallel run their first import
// can take longer than Testing Library's 1 s default.
configure({ asyncUtilTimeout: 5000 });
// Multi-page flows (lazy routes, the dock, IndexedDB) exceed Vitest's 5 s default under load.
vi.setConfig({ testTimeout: 30_000 });

vi.mock('@/features/modeler/ModelerPage', () => ({ ModelerPage: () => <p>Modeler stand-in</p> }));

// The diagrams are covered in diagram.test.ts; here they would only slow the page tests down.
vi.mock('./diagram', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  modelSvg: () =>
    Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'),
}));

function renderAt(path: string) {
  const router = createTestRouter([path]);
  render(<RouterProvider router={router} />);
  return router;
}

/**
 * Check buttons stay disabled until the attempt is saved to IndexedDB; under a loaded parallel
 * run a second click can arrive before that and would be ignored. Click only once enabled.
 */
async function clickWhenEnabled(user: ReturnType<typeof userEvent.setup>, el: HTMLElement) {
  await waitFor(() => expect(el).toBeEnabled());
  await user.click(el);
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset.theme = 'light';
  useContent.setState(fixtureContent);
  useProgress.setState({ loaded: false, lessons: {}, challenges: {}, skills: {} });
  useWorkspace.setState({ answers: {}, results: {} });
  useActiveChallenge.setState({ challengeId: null, open: true });
  useModeler.getState().newProject('Test');
  useDataLab.getState().clear();
  useAnalysisConfig.setState({ config: defaultConfig(1) });
});

afterEach(async () => {
  resetDbForTests();
  await Dexie.delete(DB_NAME);
});

describe('Learn page', () => {
  it('shows the index grouped by level and starts with the first lesson', async () => {
    renderAt('/learn');
    const nav = await screen.findByRole('navigation', { name: 'Lessons' });
    expect(within(nav).getByRole('group', { name: /Level 1/ })).toBeInTheDocument();
    expect(within(nav).getByRole('group', { name: /Level 2/ })).toBeInTheDocument();
    expect(within(nav).getAllByRole('link')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Start: What is a construct/ })).toHaveAttribute(
      'href',
      '/learn/what-is-a-construct',
    );
  });

  it('renders the lesson recipe in order', async () => {
    renderAt('/learn/what-is-a-construct');
    expect(
      await screen.findByRole('heading', { level: 2, name: 'What is a construct?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Interactive demo: Variance inflation factor' }),
    ).toBeInTheDocument();
    expect(screen.getByText('AVE = Σλ² / k')).toBeInTheDocument();
    expect(screen.getByText('Name constructs in words.')).toBeInTheDocument();
    expect(screen.getByText(/Common mistake: One item is not a construct/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try it: TAM starter/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Next: Reliability basics/ })).toHaveAttribute(
      'href',
      '/learn/reliability-basics',
    );
    // references resolve from the method registry and from content citations
    expect(screen.getByText(/Hair, J\. F\./)).toBeInTheDocument();
    expect(screen.getByText(/A fixture citation/)).toBeInTheDocument();
  });

  it('a wrong answer shows its own feedback, a right one completes the lesson, and it persists', async () => {
    const user = userEvent.setup();
    renderAt('/learn/what-is-a-construct');
    await screen.findByRole('heading', { level: 2, name: 'What is a construct?' });
    await user.click(screen.getByRole('radio', { name: 'From indicators to the construct' }));
    await clickWhenEnabled(user, screen.getByRole('button', { name: 'Check answer' }));
    expect(screen.getByText('Not quite')).toBeInTheDocument();
    expect(screen.getByText(/That is the formative direction/)).toBeInTheDocument();
    expect(
      screen.getByText(/Reflective indicators are effects of the construct/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /What is a construct\?/ })).not.toHaveTextContent(
      'completed',
    );

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await user.click(screen.getByRole('radio', { name: 'From the construct to its indicators' }));
    await clickWhenEnabled(user, screen.getByRole('button', { name: 'Check answer' }));
    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(await screen.findByText('(completed)')).toBeInTheDocument();
    await waitFor(async () => expect((await listLessonProgress())[0]?.completedAt).toBeDefined());

    // a fresh load of the store reads it back
    useProgress.setState({ loaded: false, lessons: {} });
    await useProgress.getState().load();
    expect(
      useProgress.getState().lessons['what-is-a-construct']?.checks['q-direction'],
    ).toMatchObject({ correct: true, attempts: 2 });
  });

  it('a multiple-choice check needs the whole correct set', async () => {
    const user = userEvent.setup();
    renderAt('/learn/reliability-basics');
    await screen.findByRole('heading', { level: 2, name: 'Reliability basics' });
    await user.click(screen.getByRole('checkbox', { name: 'ρC ≥ .70' }));
    await clickWhenEnabled(user, screen.getByRole('button', { name: 'Check answer' }));
    expect(screen.getByText('Not quite')).toBeInTheDocument();
    expect(screen.getByText(/You did not select “AVE ≥ .50”/)).toBeInTheDocument();
  });

  it('Try it opens the starter as a new project and goes to the modeler', async () => {
    const user = userEvent.setup();
    const router = renderAt('/learn/what-is-a-construct');
    useModeler.getState().newProject('Existing');
    await user.click(await screen.findByRole('button', { name: /Try it: TAM starter/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/modeler'));
    expect(useModeler.getState().projectName).toBe('TAM starter');
    expect(useModeler.getState().model.constructs).toHaveLength(3);
    expect(useModeler.getState().model.relationships).toHaveLength(0);
  });

  it('asks before replacing a project that has content', async () => {
    const user = userEvent.setup();
    const router = renderAt('/learn/what-is-a-construct');
    useModeler.getState().edit(() => tamModel);
    await user.click(await screen.findByRole('button', { name: /Try it: TAM starter/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Open this as a new project?' });
    expect(router.state.location.pathname).toBe('/learn/what-is-a-construct');
    await user.click(within(dialog).getByRole('button', { name: 'Open starter' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/modeler'));
  });

  it('says so for an unknown lesson and for no content at all', async () => {
    renderAt('/learn/nope');
    expect(await screen.findByText('Lesson not found')).toBeInTheDocument();
  });

  it('shows an empty state while no content exists', async () => {
    useContent.setState({ lessons: [], challenges: [], glossary: [], theories: [], citations: [] });
    renderAt('/learn');
    expect(await screen.findByText('No lessons available yet')).toBeInTheDocument();
  });
});

describe('Challenges page', () => {
  it('groups cards by category with method, difficulty and lesson chips', async () => {
    renderAt('/challenges');
    const model = await screen.findByRole('heading', { level: 2, name: 'Model' });
    expect(model).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Interpret' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Report' })).toBeNull();
    const card = within(screen.getByRole('group', { name: 'Draw the TAM' }));
    expect(card.getByText('PLS-SEM')).toBeInTheDocument();
    expect(card.getByLabelText('Difficulty 1 of 3: Easy')).toBeInTheDocument();
    expect(card.getByText(/Lesson: What is a construct\?/)).toBeInTheDocument();
    expect(card.getByText('0 of 1 tasks solved')).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Read the VIF' })).getByText('PLS & CB'),
    ).toBeInTheDocument();
  });

  it('number, choice and self-assessment tasks: check, feedback as text, completion', async () => {
    const user = userEvent.setup();
    renderAt('/challenges/interpret-vif');
    await screen.findByRole('heading', { level: 2, name: 'Read the VIF' });
    // wrong number, with a comma decimal accepted after
    await user.type(screen.getByRole('textbox', { name: 'Answer' }), '2');
    await clickWhenEnabled(user, screen.getByRole('button', { name: 'Check task 1' }));
    expect(screen.getByText('Not there yet')).toBeInTheDocument();
    expect(screen.getByText(/Use VIF = 1 \/ \(1 − R²\)/)).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Answer' }));
    await user.type(screen.getByRole('textbox', { name: 'Answer' }), '5,0');
    await clickWhenEnabled(user, screen.getByRole('button', { name: 'Check task 1' }));
    expect(screen.getByText(/VIF = 1 \/ \(1 − .80\) = 5/)).toBeInTheDocument();
    expect(
      within(screen.getByRole('listitem', { name: 'Task 1' })).getByText('Solved'),
    ).toBeInTheDocument();
    // feedback carries a text label for assistive tech, not only an icon or colour
    expect(screen.getAllByText('Correct:').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('radio', { name: /No, any VIF below 10/ }));
    await clickWhenEnabled(user, screen.getByRole('button', { name: 'Check task 2' }));
    expect(screen.getByText(/10 is a very lenient rule/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Yes, it reaches/ }));
    await clickWhenEnabled(user, screen.getByRole('button', { name: 'Check task 2' }));

    await clickWhenEnabled(user, screen.getByRole('button', { name: 'Check task 3' }));
    expect(screen.getByText(/Not yet ticked: The VIF value/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'The VIF value' }));
    await user.click(screen.getByRole('checkbox', { name: 'The guideline used' }));
    await clickWhenEnabled(user, screen.getByRole('button', { name: 'Check task 3' }));
    expect(
      await screen.findByText('Challenge completed', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(useProgress.getState().skills['Judge collinearity']).toBeDefined();
    // best score is kept: a later wrong number does not take the solved state away
    await user.clear(screen.getByRole('textbox', { name: 'Answer' }));
    await user.type(screen.getByRole('textbox', { name: 'Answer' }), '9');
    await clickWhenEnabled(user, screen.getByRole('button', { name: 'Check task 1' }));
    expect(useProgress.getState().challenges['interpret-vif']?.tasks.compute).toMatchObject({
      correct: true,
      attempts: 3,
    });
  });

  it('hints come one at a time and are counted', async () => {
    const user = userEvent.setup();
    renderAt('/challenges/interpret-vif');
    await screen.findByRole('heading', { level: 2, name: 'Read the VIF' });
    expect(screen.getByText(/Hints \(0 of 2 used\)/)).toBeInTheDocument();
    expect(screen.queryByText('Plug R² into the formula.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show a hint' }));
    expect(screen.getByText('Plug R² into the formula.')).toBeInTheDocument();
    expect(screen.queryByText('Subtract first, then divide.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show the next hint' }));
    expect(screen.getByText('Subtract first, then divide.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No more hints' })).toBeDisabled();
    expect(useProgress.getState().challenges['interpret-vif']?.hintsUsed).toBe(2);
  });

  it('the solution is behind a gentle confirmation until you have tried', async () => {
    const user = userEvent.setup();
    renderAt('/challenges/interpret-vif');
    await screen.findByRole('heading', { level: 2, name: 'Read the VIF' });
    expect(screen.queryByText(/right at the common limit/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show solution' }));
    expect(screen.getByText('Show the solution without a check first?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep trying' }));
    await user.type(screen.getByRole('textbox', { name: 'Answer' }), '3');
    await clickWhenEnabled(user, screen.getByRole('button', { name: 'Check task 1' }));
    await user.click(screen.getByRole('button', { name: 'Show solution' }));
    expect(screen.getByText(/right at the common limit/)).toBeInTheDocument();
    expect(useProgress.getState().challenges['interpret-vif']?.solutionShown).toBe(true);
  });

  it('a model task is checked against the current modeler model', async () => {
    const user = userEvent.setup();
    renderAt('/challenges/draw-the-tam');
    await screen.findByRole('heading', { level: 2, name: 'Draw the TAM' });
    useModeler
      .getState()
      .edit(() => ({ ...tamModel, relationships: [tamModel.relationships[0]!] }));
    await clickWhenEnabled(user, screen.getByRole('button', { name: 'Check task 1' }));
    expect(screen.getByText('Not there yet')).toBeInTheDocument();
    expect(screen.getByText(/Path PU → BI is missing/)).toBeInTheDocument();
    useModeler.getState().edit(() => tamModel);
    await clickWhenEnabled(user, screen.getByRole('button', { name: 'Check task 1' }));
    expect(
      await screen.findByText('Challenge completed', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('Start opens the starter, activates the challenge and shows the dock over the Modeler', async () => {
    const user = userEvent.setup();
    const router = renderAt('/challenges/draw-the-tam');
    await user.click(await screen.findByRole('button', { name: /Start: TAM challenge/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/modeler'));
    expect(useActiveChallenge.getState().challengeId).toBe('draw-the-tam');
    expect(JSON.parse(window.localStorage.getItem(ACTIVE_CHALLENGE_KEY) ?? '{}')).toMatchObject({
      id: 'draw-the-tam',
    });
    const dock = await screen.findByRole('complementary', { name: 'Active challenge' });
    expect(within(dock).getByRole('heading', { name: 'Draw the TAM' })).toBeInTheDocument();
    expect(useModeler.getState().model.relationships).toHaveLength(0);

    // Check from the dock, against the model on the canvas
    useModeler.getState().edit(() => tamModel);
    await clickWhenEnabled(user, within(dock).getByRole('button', { name: 'Check task 1' }));
    expect(await within(dock).findByText('Correct')).toBeInTheDocument();
    expect(within(dock).getByText('1 of 1 tasks solved', { exact: false })).toBeInTheDocument();

    // collapse by keyboard: focus returns to the rail button; expand again
    // a disabled button (attempt still being saved) cannot take focus; wait until it can
    const checkButton = within(dock).getByRole('button', { name: 'Check task 1' });
    await waitFor(() => expect(checkButton).toBeEnabled());
    checkButton.focus();
    expect(checkButton).toHaveFocus();
    await user.keyboard('{Escape}');
    const rail = await screen.findByRole('button', { name: /Open active challenge: Draw the TAM/ });
    expect(rail).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(rail).toHaveFocus());
    await user.click(rail);
    expect(
      await screen.findByRole('button', { name: 'Collapse challenge panel' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop challenge' }));
    expect(screen.queryByRole('complementary', { name: 'Active challenge' })).toBeNull();
  });

  it('the dock is not shown on other pages', async () => {
    useActiveChallenge.setState({ challengeId: 'draw-the-tam', open: true });
    renderAt('/learn');
    await screen.findByRole('heading', { level: 1, name: 'Lessons' });
    expect(screen.queryByRole('complementary', { name: 'Active challenge' })).toBeNull();
  });
});

describe('Reference page', () => {
  it('searches the glossary by term, alias and definition and says when nothing matches', async () => {
    const user = userEvent.setup();
    renderAt('/reference');
    await screen.findByRole('heading', { level: 1, name: 'Reference' });
    const terms = () => screen.getAllByRole('term').map((t) => t.textContent);
    expect(terms()).toHaveLength(2);
    const box = screen.getByRole('searchbox', { name: 'Search the reference' });
    await user.type(box, 'internal consistency');
    expect(terms()).toHaveLength(1);
    expect(terms()[0]).toMatch(/^Reliability/);
    await user.clear(box);
    await user.type(box, 'AVE');
    expect(terms()[0]).toMatch(/^Average variance extracted/);
    await user.clear(box);
    await user.type(box, 'zzzz');
    expect(screen.getByText('No matching terms')).toBeInTheDocument();
  });

  it('?term= focuses a glossary entry', async () => {
    renderAt('/reference?term=ave');
    const el = await screen.findByText(/mean of the squared standardized loadings/);
    expect(el.closest('.ref-term')).toHaveClass('ref-term--focus');
  });

  it('lists theories with their constructs, and the reference list resolves both sources', async () => {
    const user = userEvent.setup();
    renderAt('/reference');
    await user.click(await screen.findByRole('tab', { name: 'Theories' }));
    const card = within(screen.getByRole('group', { name: 'Technology Acceptance Model' }));
    expect(card.getByText('Perceived ease of use (PEOU)')).toBeInTheDocument();
    expect(card.getByText(/Synthetic example data only/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'References' }));
    expect(screen.getByText(/A fixture citation/)).toBeInTheDocument();
    expect(screen.getAllByText(/Hair, J\. F\./).length).toBeGreaterThan(0);
  });

  it('method cards come from the registry and never present planned methods as available', async () => {
    const user = userEvent.setup();
    renderAt('/reference');
    await user.click(await screen.findByRole('tab', { name: 'Methods' }));
    expect(screen.getByRole('group', { name: 'HTMT and HTMT2' })).toHaveTextContent('Supported');
    expect(screen.queryByRole('group', { name: 'PLSpredict' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Available now only' }));
    const planned = within(screen.getByRole('group', { name: 'PLSpredict' }));
    expect(planned.getByText('Planned: not available yet')).toBeInTheDocument();
    expect(planned.queryByText('Supported')).toBeNull();
    expect(planned.queryByText(/Reference-tested|Verified by/)).toBeNull();
    expect(screen.getByRole('group', { name: 'Robust ML (MLM)' })).toHaveTextContent(
      'Not supported',
    );
  });
});

describe('Overview', () => {
  it('Reset progress asks first, then clears all learning records', async () => {
    const user = userEvent.setup();
    await useProgress.getState().answerCheck(fixtureContent.lessons[0]!, 'q-direction', true);
    await useProgress.getState().recordTask(fixtureContent.challenges[1]!, 'compute', true);
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: 'Reset progress' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset learning progress?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(Object.keys(useProgress.getState().lessons)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Reset progress' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset progress' }),
    );
    await waitFor(() => expect(useProgress.getState().lessons).toEqual({}));
    expect(await listLessonProgress()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Reset progress' })).not.toBeInTheDocument();
  });

  it('Overview shows learning progress', async () => {
    await useProgress.getState().answerCheck(fixtureContent.lessons[0]!, 'q-direction', true);
    renderAt('/');
    expect(await screen.findByText('Lessons: 1 of 2 completed')).toBeInTheDocument();
    expect(screen.getByText('Challenges: 0 of 2 completed')).toBeInTheDocument();
  });
});
