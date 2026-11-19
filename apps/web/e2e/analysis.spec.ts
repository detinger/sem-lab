import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 3 vertical slice against the REAL API and R engine (see playwright.config.ts):
 * sample data → "Two constructs" model → Analysis → confirm → run (cancel one, finish one) →
 * Results → Copy table → Modeler overlay → delete the job. Screenshots go to
 * test-results/phase3/ and must be looked at.
 */
const OUT = 'test-results/phase3';

async function expandLayout(page: Page) {
  await page.addStyleTag({
    content: `.shell, .shell__column, .shell__main { height: auto !important; max-height: none !important; overflow: visible !important; }`,
  });
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of ['light', 'dark'] as const) {
  test(`analysis slice: import → model → run → results → overlay (${theme})`, async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://localhost:5173',
    });
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    const jobIds: string[] = [];
    page.on('response', async (r) => {
      if (r.url().endsWith('/api/analysis/jobs') && r.request().method() === 'POST' && r.ok()) {
        jobIds.push(((await r.json()) as { id: string }).id);
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((value) => {
      window.localStorage.setItem('sem-studio:theme', value);
    }, theme);

    // --- model + data (as in the Data Lab spec)
    await page.goto('/modeler');
    await page
      .locator('.modeler-start-card', { hasText: 'Two constructs' })
      .getByRole('button', { name: 'Use template' })
      .click();
    await expect(page.locator('.react-flow__node-construct')).toHaveCount(2);
    await page.getByRole('link', { name: 'Data', exact: true }).click();
    await page.getByRole('button', { name: /Use sample dataset/ }).click();
    await page.getByRole('menuitem', { name: /Two reflective constructs/ }).click();
    await expect(page.getByRole('region', { name: 'Preview of the working table' })).toBeVisible();
    await page.getByRole('button', { name: 'Set 1–7 for all indicators of X' }).click();
    await page.getByRole('button', { name: 'Set 1–7 for all indicators of Y' }).click();

    // --- Analysis, idle
    await page.getByRole('link', { name: 'Analysis', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Analysis' })).toBeVisible();
    await expect(page.getByText(/Engine r-csem available/)).toBeVisible();
    await expect(page.getByText(/rows will be used/)).toBeVisible();
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/analysis-idle-${theme}.png`, fullPage: true });

    // --- first run: large B, cancelled while bootstrapping (determinate progress)
    await page.getByLabel('Bootstrap samples (B)').fill('10000');
    await page.getByRole('button', { name: 'Run analysis' }).click();
    const dialog = page.getByRole('dialog', { name: /Data leaves your browser/ });
    await expect(dialog).toContainText('localhost:8000');
    await expect(dialog).toContainText('Up to 24 hours');
    await page.screenshot({ path: `${OUT}/analysis-confirm-${theme}.png` });
    await dialog.getByRole('button', { name: 'Send data and run' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(/bootstrap samples \(\d+ failed, \d+ inadmissible\)/),
    ).toBeVisible();
    await page.screenshot({ path: `${OUT}/analysis-running-${theme}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Analysis cancelled')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Dismiss' }).click();

    // --- second run: B = 200, no second confirmation
    await page.getByLabel('Bootstrap samples (B)').fill('200');
    await page.getByRole('button', { name: 'Run analysis' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Results' })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByLabel('Run provenance')).toContainText('B = 200 (200 valid');

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
    expect(clip.html).toContain('<thead>');
    expect(clip.text).toContain('\t');
    expect(clip.text).toContain('β');

    // --- Modeler overlay
    await page.getByRole('link', { name: 'Modeler', exact: true }).click();
    await page.getByRole('radio', { name: 'Estimates' }).click();
    await expect(page.locator('.sem-pill').first()).toBeVisible();
    await expect(page.locator('.sem-capsule').first()).toContainText('R²');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/modeler-overlay-estimates-${theme}.png` });
    await page.getByRole('radio', { name: 'p', exact: true }).click();
    await page.screenshot({ path: `${OUT}/modeler-overlay-p-${theme}.png` });

    // --- delete the uploaded data and jobs
    await page.getByRole('link', { name: 'Analysis', exact: true }).click();
    expect(jobIds.length).toBeGreaterThanOrEqual(2);
    await page
      .getByRole('button', { name: /Delete uploaded data and jobs for this project/ })
      .click();
    await expect(page.getByText('Uploaded data and jobs deleted from the service')).toBeVisible();
    for (const id of jobIds) {
      const res = await page.request.get(`http://localhost:8000/api/analysis/jobs/${id}`);
      expect(res.status()).toBe(404);
    }
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/analysis-history-${theme}.png`, fullPage: true });
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
