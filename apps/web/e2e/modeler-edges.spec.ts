import { expect, test } from '@playwright/test';
import { seedModel, setup } from './helpers';
import { TWO_CONSTRUCT_MODEL } from './fixtures/models';

/**
 * Regression: with a results overlay on, selecting a node made every edge vanish until reload.
 * The canvas rebuilds its controlled nodes on each store change; passed without `measured`,
 * React Flow dropped their handle measurements and skipped all edges touching them.
 */
test('edges survive selection and overlay changes after a run', async ({ page }) => {
  test.setTimeout(180_000);
  await setup(page, 'light');
  await seedModel(page, TWO_CONSTRUCT_MODEL, 'Two constructs');
  const edges = page.locator('.react-flow__edge path.sem-edge');
  await expect(edges).not.toHaveCount(0);
  const n = await edges.count();

  await page
    .getByRole('group', { name: 'Workspace' })
    .getByRole('link', { name: 'Data', exact: true })
    .click();
  await page.getByRole('button', { name: /Use sample dataset/ }).click();
  await page.getByRole('menuitem', { name: /Two reflective constructs/ }).click();
  await page.getByRole('link', { name: 'Analysis', exact: true }).click();
  await page.getByLabel('Bootstrap samples (B)').fill('100');
  await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Results' })).toBeVisible({
    timeout: 120_000,
  });

  await page.getByRole('link', { name: 'Modeler', exact: true }).click();
  const steps = [
    () => page.locator('.react-flow__node-construct').first().click(),
    () => page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } }),
    () => page.getByRole('radio', { name: 'Est.', exact: true }).click(),
    () => page.locator('.react-flow__node-construct').nth(1).click(),
    () => page.getByRole('radio', { name: 'p', exact: true }).click(),
    () => page.locator('.react-flow__node-indicator').first().click(),
    () => page.getByRole('radio', { name: 'Model', exact: true }).click(),
    () => page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } }),
  ];
  for (const step of steps) {
    await step();
    await page.waitForTimeout(200);
    await expect(edges).toHaveCount(n);
  }
});
