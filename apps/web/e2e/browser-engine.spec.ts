import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  OUT,
  REPO,
  canonical,
  exampleModel,
  expandLayout,
  fixtureModel,
  lastRun,
  openModelAndSample,
  setup,
  watch,
} from './helpers';

/** CB-SEM, IPMA and the performance/equality check of the worker pool. */

/** packages/python-engine's venv (uv sync); the Python export check is skipped without it. */
const PY = join(REPO, 'packages', 'python-engine', '.venv', 'bin', 'python');

for (const theme of ['light', 'dark'] as const) {
  test(`CB-SEM on the service-quality sample: fit table and Std/Unstd toggle (${theme})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { errors, uploads } = watch(page);
    await setup(page, theme);
    await openModelAndSample(page, fixtureModel('service-quality'), /Service quality/);
    await page.getByRole('link', { name: 'Analysis', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Analysis' })).toBeVisible();
    await page.getByRole('radio', { name: /CB-SEM/ }).click();
    await expect(page.getByLabel('Bootstrap samples (B)')).toHaveCount(0);
    await expect(page.getByText(/Bootstrap for CB-SEM is not available yet/)).toBeVisible();
    await expect(page.getByRole('radio', { name: 'MLM' })).toBeDisabled();
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/cb-analysis-${theme}.png`, fullPage: true });
    await expect(page.getByRole('button', { name: 'Run analysis' })).toBeEnabled();
    await page.getByRole('button', { name: 'Run analysis' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Results' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByLabel('Run provenance')).toContainText('CB-SEM, ML, marker');
    await expect(page.getByRole('tab', { name: 'Bootstrap' })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Fit' }).click();
    const fit = page.getByRole('group', { name: 'Model fit' });
    await expect(fit.getByText('RMSEA [90% CI]')).toBeVisible();
    await expect(fit.getByRole('cell', { name: 'SRMR', exact: true })).toBeVisible();
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/cb-results-fit-${theme}.png`, fullPage: true });

    await page.getByRole('tab', { name: 'Structural' }).click();
    const paths = page.getByRole('group', { name: /Structural paths/ });
    await expect(paths).toContainText('Structural paths (standardized)');
    await expect(page.getByText(/Showing standardized estimates/)).toBeVisible();
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/cb-results-std-${theme}.png`, fullPage: true });
    await page.getByRole('radio', { name: 'Unstandardized' }).first().click();
    await expect(paths).toContainText('Structural paths (unstandardized)');
    await expect(page.getByText(/Showing unstandardized estimates/)).toBeVisible();
    await page.screenshot({ path: `${OUT}/cb-results-unstd-${theme}.png`, fullPage: true });

    await page.getByRole('tab', { name: 'Reproducibility' }).click();
    await expect(page.getByRole('button', { name: 'Export R script' })).toBeEnabled();
    await page.screenshot({ path: `${OUT}/cb-reproducibility-${theme}.png`, fullPage: true });
    if (theme === 'light' && existsSync(PY)) {
      // The Python bundle downloaded from the real app runs and matches the app's numbers.
      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export Python script' }).click(),
      ]);
      expect(dl.suggestedFilename()).toMatch(/-Python-export\.zip$/);
      const dir = mkdtempSync(join(tmpdir(), 'sem-e2e-py-'));
      await dl.saveAs(join(dir, 'bundle.zip'));
      execFileSync('unzip', ['-q', 'bundle.zip'], { cwd: dir });
      const folder = readdirSync(dir).find((f) => f !== 'bundle.zip')!;
      const out = execFileSync(PY, ['-I', 'run_analysis.py'], {
        cwd: join(dir, folder),
        encoding: 'utf8',
        timeout: 120_000,
      });
      expect(out).toMatch(/Check against the app: \d+ numbers, largest difference .* -> OK/);
    }

    // Modeler overlay with the scale toggle
    await page.getByRole('link', { name: 'Modeler', exact: true }).click();
    await page.getByRole('radio', { name: 'Estimates' }).click();
    await expect(page.locator('.sem-pill').first()).toBeVisible();
    const stdPill = await page.locator('.sem-pill').first().textContent();
    await page.getByRole('radio', { name: 'Standardized', exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/cb-overlay-std-${theme}.png` });
    await page.getByRole('radio', { name: 'Unstandardized', exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByLabel('Overlay legend')).toContainText('Unstandardized');
    await page.screenshot({ path: `${OUT}/cb-overlay-unstd-${theme}.png` });
    expect(stdPill).toBeTruthy();

    expect(uploads, uploads.join('\n')).toEqual([]);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test(`IPMA flow on ipma-range-restricted (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    const { errors, uploads } = watch(page);
    await setup(page, theme);
    await openModelAndSample(
      page,
      fixtureModel('ipma-range-restricted'),
      /IPMA with range-restricted/,
    );
    await page.getByRole('link', { name: 'Analysis', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Analysis' })).toBeVisible();
    const target = page.getByLabel('Target construct');
    await expect(target).toBeEnabled();
    const options = await target.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(1);
    await target.selectOption({ index: options.length - 1 });
    await page.getByLabel('Bootstrap samples (B)').fill('100');
    await expect(page.getByRole('button', { name: 'Run analysis' })).toBeEnabled();
    await page.getByRole('button', { name: 'Run analysis' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Results' })).toBeVisible({
      timeout: 90_000,
    });
    await page.getByRole('link', { name: 'IPMA', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'IPMA' })).toBeVisible();
    await expect(page.getByTestId('ipma-target')).toBeVisible();
    await expect(
      page.getByText('Performance uses original survey scale endpoints.').first(),
    ).toBeVisible();
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/ipma-${theme}.png`, fullPage: true });
    expect(uploads, uploads.join('\n')).toEqual([]);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('ACSI 2015, PLS B = 1,000: single worker vs worker pool give identical results; timing', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const { errors, uploads } = watch(page);
  await setup(page, 'light');
  const acsi = exampleModel('acsi-2015');
  const cores = await page.evaluate(() => navigator.hardwareConcurrency);
  await openModelAndSample(page, acsi.model, /American Customer Satisfaction Index/);
  await page.getByRole('link', { name: 'Analysis', exact: true }).click();
  await page.getByLabel('Bootstrap samples (B)').fill('1000');
  await page.getByLabel('Seed').fill('20150101');

  const runOnce = async (workers: number | null) => {
    await page.evaluate((w) => {
      (
        window as unknown as { __semStudioTest: { setWorkers: (n: number | null) => void } }
      ).__semStudioTest.setWorkers(w);
    }, workers);
    await expect(page.getByRole('button', { name: 'Run analysis' })).toBeEnabled();
    await page.getByRole('button', { name: 'Run analysis' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Results' })).toBeVisible({
      timeout: 600_000,
    });
    const run = await lastRun(page);
    expect(run?.status).toBe('complete');
    await page.getByRole('link', { name: 'Analysis', exact: true }).click();
    return run!;
  };

  const single = await runOnce(1);
  const pool = await runOnce(null);
  const singleS = single.durationMs! / 1000;
  const poolS = pool.durationMs! / 1000;
  const log = `ACSI 2015 (n = 8,239, PLS-SEM, B = 1,000, seed 20150101), Chrome, ${cores} logical cores, pool = max(1, min(${cores} - 1, 8)) = ${Math.max(1, Math.min(cores - 1, 8))} draw workers\nsingle worker: ${singleS.toFixed(1)} s\nworker pool:   ${poolS.toFixed(1)} s\nspeed-up: ${(singleS / poolS).toFixed(2)}x\nresults identical (JSON, timestamps excluded): ${canonical(single.result) === canonical(pool.result)}\n`;
  process.stdout.write(log);
  writeFileSync(`${OUT}/acsi-timing.txt`, log);
  expect(canonical(pool.result)).toBe(canonical(single.result));
  const boot = (pool.result as { bootstrap: { requested: number; completed: number } }).bootstrap;
  expect(boot.requested).toBe(1000);
  expect(uploads, uploads.join('\n')).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});
