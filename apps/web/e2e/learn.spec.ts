import { expect, test, type Page } from '@playwright/test';
import { expandLayout, setup, watch } from './helpers';

/**
 * Phase 6 learning UI: lessons, knowledge checks and their persistence, the challenge workspace
 * with the docked panel over the Modeler, challenge cards and the Reference page. The specs run
 * on the development-only fixture content (localStorage flag), so they do not depend on how much
 * of content/ has been written. Screenshots go to test-results/phase6-learn/ and must be looked at.
 */
const OUT = 'test-results/phase6-learn';

const tam = {
  constructs: [
    { id: 'c_peou', name: 'PEOU', measurement: 'reflective', indicatorIds: ['i_e1', 'i_e2'] },
    { id: 'c_pu', name: 'PU', measurement: 'reflective', indicatorIds: ['i_u1', 'i_u2'] },
    { id: 'c_bi', name: 'BI', measurement: 'reflective', indicatorIds: ['i_b1', 'i_b2'] },
  ],
  indicators: ['peou1', 'peou2', 'pu1', 'pu2', 'bi1', 'bi2'].map((n, i) => ({
    id: ['i_e1', 'i_e2', 'i_u1', 'i_u2', 'i_b1', 'i_b2'][i],
    name: n,
    column: null,
  })),
  relationships: [
    { id: 'r1', kind: 'structural', sourceId: 'c_peou', targetId: 'c_pu' },
    { id: 'r2', kind: 'structural', sourceId: 'c_pu', targetId: 'c_bi' },
  ],
};

async function withFixtures(page: Page, theme: 'light' | 'dark') {
  await setup(page, theme);
  await page.addInitScript(() => window.localStorage.setItem('sem-studio:learn-fixtures', '1'));
}

for (const theme of ['light', 'dark'] as const) {
  test(`learn: lesson, demo and knowledge check (${theme})`, async ({ page }) => {
    const { errors, uploads } = watch(page);
    await withFixtures(page, theme);
    await page.goto('/learn');
    await expect(page.getByRole('heading', { level: 1, name: 'Lessons' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Start: What is a construct/ })).toBeVisible();
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/learn-index-${theme}.png`, fullPage: true });

    await page.goto('/learn/what-is-a-construct');
    await expect(
      page.getByRole('heading', { level: 2, name: 'What is a construct?' }),
    ).toBeVisible();
    // the lesson diagram is drawn by the modeler's exporter
    await expect(page.locator('.diagram__canvas svg').first()).toBeVisible();
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/lesson-${theme}.png`, fullPage: true });
    await page
      .getByRole('region', { name: /Interactive demo/ })
      .screenshot({ path: `${OUT}/demo-vif-${theme}.png` });

    if (theme === 'light') {
      await page.getByRole('radio', { name: 'From indicators to the construct' }).check();
      await page.getByRole('button', { name: 'Check answer' }).click();
      await expect(page.getByText('Not quite')).toBeVisible();
      await expect(page.getByText(/That is the formative direction/)).toBeVisible();
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.getByRole('radio', { name: 'From the construct to its indicators' }).check();
      await page.getByRole('button', { name: 'Check answer' }).click();
      await expect(page.getByText('Correct', { exact: true })).toBeVisible();
      await expect(page.getByText('(completed)')).toBeAttached();

      // completion survives a reload (IndexedDB)
      await page.reload();
      await expect(
        page.getByRole('heading', { level: 2, name: 'What is a construct?' }),
      ).toBeVisible();
      await expect(page.getByText('(completed)')).toBeAttached();
      await expect(page.getByText('1 of 2 completed')).toBeVisible();
    }
    expect(uploads, uploads.join('\n')).toEqual([]);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test(`challenges: cards, workspace dock over the Modeler (${theme})`, async ({ page }) => {
    test.setTimeout(90_000);
    const { errors, uploads } = watch(page);
    await withFixtures(page, theme);
    await page.goto('/challenges');
    await expect(page.getByRole('heading', { level: 2, name: 'Model' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Draw the TAM' })).toBeVisible();
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/challenges-${theme}.png`, fullPage: true });

    await page.goto('/challenges/draw-the-tam');
    await expect(page.getByRole('heading', { level: 2, name: 'Draw the TAM' })).toBeVisible();
    await page.getByRole('button', { name: /Start: TAM challenge/ }).click();
    await expect(page).toHaveURL(/\/modeler$/);
    const dock = page.getByRole('complementary', { name: 'Active challenge' });
    await expect(dock).toBeVisible();
    await expect(page.locator('.react-flow__node-construct').first()).toBeVisible({
      timeout: 30_000,
    });
    await dock.getByRole('button', { name: 'Check task 1' }).click();
    await expect(dock.getByText('Not there yet')).toBeVisible();
    await expect(dock.getByText(/Path PEOU → PU is missing/)).toBeVisible();

    // load the correct model through the test hook; the dock reads the real project
    await page.waitForFunction(() =>
      Boolean((window as unknown as Record<string, unknown>).__semStudioTest),
    );
    await page.evaluate(
      (m) =>
        (
          window as unknown as { __semStudioTest: { loadModel: (m: unknown) => Promise<void> } }
        ).__semStudioTest.loadModel(m),
      tam,
    );
    await expect(page.locator('.react-flow__node-construct')).toHaveCount(3);
    await dock.getByRole('button', { name: 'Check task 1' }).click();
    await expect(dock.getByText('Correct', { exact: true })).toBeVisible();
    await expect(dock.getByText(/1 of 1 tasks solved/)).toBeVisible();
    await page.screenshot({ path: `${OUT}/challenge-dock-modeler-${theme}.png` });

    // the dock follows the student to other workspace pages and collapses by keyboard
    await page.getByRole('link', { name: 'Data', exact: true }).click();
    await expect(dock).toBeVisible();
    await dock.getByRole('button', { name: 'Check task 1' }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /Open active challenge/ })).toBeFocused();
    await expect(page.locator('#challenge-dock-panel')).toHaveCount(0);

    await page.goto('/challenges/draw-the-tam');
    await expect(page.getByText('Challenge completed')).toBeVisible();
    expect(uploads, uploads.join('\n')).toEqual([]);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test(`reference page (${theme})`, async ({ page }) => {
    const { errors, uploads } = watch(page);
    await withFixtures(page, theme);
    await page.goto('/reference');
    await expect(page.getByRole('heading', { level: 1, name: 'Reference' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search the reference' }).fill('consistency');
    await expect(page.getByRole('term')).toHaveCount(1);
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/reference-glossary-${theme}.png`, fullPage: true });
    await page.getByRole('searchbox', { name: 'Search the reference' }).fill('');
    await page.getByRole('tab', { name: 'Methods' }).click();
    await expect(page.getByRole('group', { name: 'HTMT and HTMT2' })).toBeVisible();
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/reference-methods-${theme}.png`, fullPage: true });
    expect(uploads, uploads.join('\n')).toEqual([]);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('examples: model previews and notebook downloads', async ({ page }) => {
  const { errors, uploads } = watch(page);
  await setup(page, 'light');
  await page.goto('/examples');
  await expect(page.getByRole('button', { name: /^Open example/ })).toHaveCount(6);
  await expect(page.locator('.ex-card .diagram__canvas svg')).toHaveCount(6, { timeout: 30_000 });
  const links = page.getByRole('link', { name: /^Download notebook/ });
  await expect(links).toHaveCount(5);
  const href = await links.first().getAttribute('href');
  const res = await page.request.get(href ?? '/');
  expect(res.ok()).toBe(true);
  await expandLayout(page);
  await page.screenshot({ path: `${OUT}/examples-light.png`, fullPage: true });
  expect(uploads, uploads.join('\n')).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});
