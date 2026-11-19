import { expect, test } from '@playwright/test';
import { expandLayout, setup, watch } from './helpers';

/**
 * Examples gallery: open the DeLone & McLean example in one click, run it in the browser and
 * look at Results and IPMA. Screenshots go to test-results/phase4-examples/ and must be looked at.
 */
const OUT = 'test-results/phase4-examples';

for (const theme of ['light', 'dark'] as const) {
  test(`examples gallery (${theme})`, async ({ page }) => {
    test.setTimeout(240_000);
    const { errors, uploads } = watch(page);
    await setup(page, theme);
    await page.goto('/examples');
    await expect(page.getByRole('heading', { level: 1, name: 'Examples & Colab' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Open example/ })).toHaveCount(6);
    await expandLayout(page);
    await page.screenshot({ path: `${OUT}/gallery-${theme}.png`, fullPage: true });

    if (theme === 'dark') {
      expect(uploads, uploads.join('\n')).toEqual([]);
      expect(errors, errors.join('\n')).toEqual([]);
      return;
    }

    await page.getByRole('button', { name: /^Open example: .*DeLone/ }).click();
    await expect(page.locator('.react-flow__node-construct').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/modeler$/);
    await page.getByRole('link', { name: 'Analysis', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Analysis' })).toBeVisible();
    await expect(page.getByLabel('Bootstrap samples (B)')).toHaveValue('5000');
    await expect(page.getByLabel('Target construct')).not.toHaveValue('');
    await page.getByLabel('Bootstrap samples (B)').fill('100');
    await expect(page.getByRole('button', { name: 'Run analysis' })).toBeEnabled();
    await page.getByRole('button', { name: 'Run analysis' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Results' })).toBeVisible({
      timeout: 120_000,
    });
    await page.getByRole('link', { name: 'IPMA', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'IPMA' })).toBeVisible();
    await expect(page.getByTestId('ipma-target')).toBeVisible();
    expect(await page.locator('.ipma-pt').count()).toBeGreaterThan(2);
    expect(uploads, uploads.join('\n')).toEqual([]);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
