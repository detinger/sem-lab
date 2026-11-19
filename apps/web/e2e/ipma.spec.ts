import { expect, test } from '@playwright/test';

/**
 * IPMA page from the stored real-engine fixture. The run is injected through the dev-only hook
 * `window.__semStudioTest.loadIpmaFixture()` (src/features/ipma/devHook.ts; absent in production
 * builds). Screenshots go to test-results/phase4-ipma/ and must be looked at.
 */
const OUT = 'test-results/phase4-ipma';

for (const theme of ['light', 'dark'] as const) {
  for (const vp of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`ipma page (${theme}, ${vp.name})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.addInitScript((value) => {
        window.localStorage.setItem('sem-studio:theme', value);
      }, theme);
      await page.goto('/ipma');
      await expect(page.getByRole('heading', { level: 1, name: 'IPMA' })).toBeVisible();
      await page.waitForFunction(() =>
        Boolean((window as unknown as Record<string, unknown>).__semStudioTest),
      );
      await page.evaluate(() =>
        (
          window as unknown as { __semStudioTest: { loadIpmaFixture: () => Promise<void> } }
        ).__semStudioTest.loadIpmaFixture(),
      );
      await expect(page.getByTestId('ipma-target')).toBeVisible();
      await page.locator('.ipma-pt').first().click();
      await page.getByLabel('Show reference lines').check();
      await page.addStyleTag({
        content: `.shell, .shell__column, .shell__main { height: auto !important; max-height: none !important; overflow: visible !important; }`,
      });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${OUT}/ipma-${theme}-${vp.name}.png`, fullPage: true });
      await expect(
        page.getByText('Performance uses original survey scale endpoints.').first(),
      ).toBeVisible();
      if (vp.name === 'mobile') {
        await expect(page.locator('.ipma-label')).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'IPMA data', exact: true })).toBeVisible();
      }
    });
  }
}
