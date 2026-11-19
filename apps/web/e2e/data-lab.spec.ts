import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 2 exit criterion (PLAN §5): map a (synthetic) CSV to a model, see broken specifications
 * and readiness. Screenshots go to test-results/phase2-data-lab/ and must be looked at.
 */

const SIZES = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

async function prepare(page: Page, theme: 'light' | 'dark', size: keyof typeof SIZES) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SIZES[size]);
  await page.addInitScript((value) => {
    window.localStorage.setItem('sem-lab:theme', value);
  }, theme);

  // Build the model: the "two constructs" template matches the bundled pls-two-construct data.
  await page.goto('/modeler');
  await page.getByRole('heading', { name: 'Two constructs' }).waitFor();
  await page
    .locator('.modeler-start-card', { hasText: 'Two constructs' })
    .getByRole('button', { name: 'Use template' })
    .click();
  await expect(page.locator('.react-flow__node-construct')).toHaveCount(2);

  // Navigate inside the app so the open project is kept in memory.
  await page.getByRole('link', { name: 'Data', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Data' })).toBeVisible();
  await page.getByRole('button', { name: /Use sample dataset/ }).click();
  await page.getByRole('menuitem', { name: /Two reflective constructs/ }).click();
  await expect(page.getByRole('heading', { name: /Two reflective constructs/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Preview of the working table' })).toBeVisible();
  return errors;
}

/** Let the page grow to its content so one full-page screenshot shows every section. */
async function expandLayout(page: Page) {
  await page.addStyleTag({
    content: `.shell, .shell__column, .shell__main { height: auto !important; max-height: none !important; overflow: visible !important; }
      .dl-scroll { max-height: none !important; }`,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

for (const theme of ['light', 'dark'] as const) {
  for (const size of ['desktop', 'mobile'] as const) {
    test(`Data Lab maps a sample dataset to the model (${theme}, ${size})`, async ({ page }) => {
      const errors = await prepare(page, theme, size);

      // Scale endpoints are missing, so the IPMA callout and a warning-level story appear.
      await expect(page.getByText(/Set the permitted minimum and maximum/)).toBeVisible();
      await page.getByRole('button', { name: 'Set 1–7 for all indicators of X' }).click();
      await page.getByRole('button', { name: 'Set 1–7 for all indicators of Y' }).click();
      await expect(page.getByText(/Set the permitted minimum and maximum/)).toHaveCount(0);

      // Readiness for the chosen method; no errors block this correctly mapped model.
      await expect(page.getByRole('status').filter({ hasText: /errors? ·/ })).toContainText(
        'no errors block the analysis',
      );
      await expect(page.getByRole('button', { name: 'Show in mapping' })).toHaveCount(0);

      await expandLayout(page);
      await page.screenshot({
        path: `test-results/phase2-data-lab/data-${theme}-${size}.png`,
        fullPage: true,
      });

      // No page-level horizontal overflow (tables scroll inside their own regions).
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
}

test('a broken mapping blocks analysis and the Modeler shows the same issue', async ({ page }) => {
  await page.setViewportSize(SIZES.desktop);
  await prepare(page, 'light', 'desktop');
  // Rebind one indicator to a column that the data do not have.
  await page.getByLabel('x1 scale minimum').scrollIntoViewIfNeeded();
  await page.getByLabel('Column for x1').selectOption('');
  await expect(page.getByText(/1 indicator is not mapped to a data column/)).toBeVisible();
  await expect(page.getByText(/analysis is blocked while errors remain/)).toBeVisible();
  await page.screenshot({ path: 'test-results/phase2-data-lab/broken-mapping.png' });

  await page.getByRole('link', { name: 'Modeler', exact: true }).click();
  await page.getByRole('button', { name: /Check model/ }).click();
  await expect(page.getByRole('region', { name: 'Check model' })).toContainText(
    'not mapped to a data column',
  );
  await page.getByRole('button', { name: 'Focus element' }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/phase2-data-lab/modeler-check.png' });
});
