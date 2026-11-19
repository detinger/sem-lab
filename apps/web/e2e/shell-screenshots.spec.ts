import { expect, test } from '@playwright/test';

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
const PAGES = [
  { slug: 'overview', path: '/' },
  { slug: 'settings', path: '/settings' },
  { slug: 'placeholder-data', path: '/data' },
  { slug: 'gallery', path: '/dev/ui' },
] as const;

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    for (const page of PAGES) {
      test(`${page.slug} ${theme} ${viewport.name}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        await context.addInitScript((value) => {
          window.localStorage.setItem('sem-lab:theme', value);
        }, theme);
        const tab = await context.newPage();
        await tab.goto(page.path);
        await expect(tab.getByRole('heading', { level: 1 })).toBeVisible();
        await tab.evaluate(() => document.fonts.ready);
        await expect(tab.locator('html')).toHaveAttribute('data-theme', theme);

        // Nothing may force the page wider than the viewport.
        const overflow = await tab.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);

        if (page.slug === 'gallery') {
          // The shell scrolls inside <main>, so grow the viewport to show the whole page.
          const height = await tab.evaluate(
            () => (document.querySelector('main')?.scrollHeight ?? 0) + 140,
          );
          await tab.setViewportSize({ width: viewport.width, height });
        }
        await tab.screenshot({
          path: `test-results/phase1-shell/${page.slug}-${theme}-${viewport.name}.png`,
        });
        await context.close();
      });
    }
  }
}
