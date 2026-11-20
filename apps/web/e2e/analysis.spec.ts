import { expect, test } from '@playwright/test';
import { OUT, expandLayout, setup, watch } from './helpers';

/**
 * Phase 4 vertical slice, entirely in the browser (no API server): sample data → "Two constructs"
 * model → Analysis → run (cancel one, finish one with B = 200) → Results → Copy table → Modeler
 * overlay. Screenshots go to test-results/phase4-browser/ and must be looked at.
 */
for (const theme of ['light', 'dark'] as const) {
  test(`analysis slice in the browser: import → model → run → results → overlay (${theme})`, async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://localhost:5173',
    });
    const { errors, uploads } = watch(page);
    await setup(page, theme);

    // --- model + data
    await page.goto('/modeler');
    await page
      .locator('.modeler-start-card', { hasText: 'Two constructs' })
      .getByRole('button', { name: 'Use template' })
      .click();
    await expect(page.locator('.react-flow__node-construct')).toHaveCount(2);
    await page
      .getByRole('group', { name: 'Workspace' })
      .getByRole('link', { name: 'Data', exact: true })
      .click();
    await page.getByRole('button', { name: /Use sample dataset/ }).click();
    await page.getByRole('menuitem', { name: /Two reflective constructs/ }).click();
    await expect(page.getByRole('region', { name: 'Preview of the working table' })).toBeVisible();
    await page.getByRole('button', { name: 'Set 1–7 for all indicators of X' }).click();
    await page.getByRole('button', { name: 'Set 1–7 for all indicators of Y' }).click();

    // --- Analysis, idle
    await page.getByRole('link', { name: 'Analysis', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Analysis' })).toBeVisible();
    await expect(page.getByText('SEM Lab engine (runs in this browser)').first()).toBeVisible();
    await expect(
      page.getByText('Your data stay on this device; nothing is uploaded.'),
    ).toBeVisible();
    await expect(page.getByText(/rows will be used/)).toBeVisible();
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/analysis-idle-${theme}.png`, fullPage: true });

    // --- first run: the largest B the app allows, cancelled while bootstrapping (determinate
    // progress). Cancel is clicked as soon as progress shows: with the worker pool this small
    // model can finish 10,000 draws in a few seconds, so nothing slow may come before the click.
    await page.getByLabel('Bootstrap samples (B)').fill('10000');
    await page.getByRole('button', { name: 'Run analysis' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('progressbar')).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(/bootstrap samples \(\d+ failed, \d+ inadmissible\)/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Analysis cancelled')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${OUT}/analysis-cancelled-${theme}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Dismiss' }).click();

    // --- second run: B = 200
    await page.getByLabel('Bootstrap samples (B)').fill('200');
    await page.getByRole('button', { name: 'Run analysis' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Results' })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByLabel('Run provenance')).toContainText('B = 200 (200 valid');
    await expect(page.getByLabel('Run provenance')).toContainText(
      'SEM Lab engine (in browser), @sem-lab/engine 0.1.0',
    );

    // --- Results tabs
    for (const tab of [
      'Summary',
      'Measurement',
      'Structural',
      'Bootstrap',
      'Fit',
      'Reproducibility',
    ]) {
      await page.getByRole('tab', { name: tab }).click();
      await expandLayout(page);
      await page.screenshot({
        path: `${OUT}/results-${tab.toLowerCase()}-${theme}.png`,
        fullPage: true,
      });
    }

    // --- Copy table: the clipboard holds an HTML table and a TSV fallback
    await page.getByRole('tab', { name: 'Structural' }).click();
    await page
      .getByRole('group', { name: 'Path coefficients' })
      .getByRole('button', { name: 'Copy table' })
      .click();
    await expect(page.getByText('Table copied — paste into Word or Google Docs')).toBeVisible();
    const clip = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      const get = async (t: string) => (item ? await (await item.getType(t)).text() : '');
      return {
        types: item?.types ?? [],
        html: await get('text/html'),
        text: await get('text/plain'),
      };
    });
    expect(clip.types).toEqual(expect.arrayContaining(['text/html', 'text/plain']));
    expect(clip.html).toContain('<table');
    expect(clip.text).toContain('\t');
    expect(clip.text).toContain('β');

    // --- Modeler overlay
    await page.getByRole('link', { name: 'Modeler', exact: true }).click();
    await page.getByRole('radio', { name: 'Est.', exact: true }).click();
    await expect(page.locator('.sem-pill').first()).toBeVisible();
    await expect(page.locator('.sem-capsule').first()).toContainText('R²');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/modeler-overlay-estimates-${theme}.png` });
    await page.getByRole('radio', { name: 'p', exact: true }).click();
    await page.screenshot({ path: `${OUT}/modeler-overlay-p-${theme}.png` });

    // --- run history with measured durations
    await page.getByRole('link', { name: 'Analysis', exact: true }).click();
    await expect(page.getByRole('columnheader', { name: 'Duration' })).toBeVisible();
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/analysis-history-${theme}.png`, fullPage: true });

    expect(uploads, uploads.join('\n')).toEqual([]);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
