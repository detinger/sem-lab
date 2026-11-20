import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 1 exit criterion (PLAN §5): build a readable TAM diagram, auto arrange it, save/reopen
 * and export it without an analysis backend. Screenshots go to test-results/phase1-modeler/.
 */

async function openWithTam(page: Page, theme: 'light' | 'dark'): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((value) => {
    window.localStorage.setItem('sem-lab:theme', value);
  }, theme);
  await page.goto('/modeler');
  await page.getByRole('button', { name: 'Use template' }).first().click();
  await expect(page.locator('.react-flow__node-construct')).toHaveCount(5);
  await expect(page.locator('.react-flow__node-indicator')).toHaveCount(22);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return errors;
}

for (const theme of ['light', 'dark'] as const) {
  test(`TAM template renders cleanly (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = await openWithTam(page, theme);
    await page.screenshot({ path: `test-results/phase1-modeler/tam-${theme}.png` });

    // Select a construct: the inspector shows it and the arrows keep their meaning.
    await page.getByRole('button', { name: 'Show inspector' }).click();
    await page.locator('.react-flow__node-construct', { hasText: 'PU' }).first().click();
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText(
      'Construct · PU',
    );
    await page.screenshot({ path: `test-results/phase1-modeler/tam-selected-${theme}.png` });
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('arrange, undo, shortcuts and SVG export work end to end', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openWithTam(page, 'light');
  const before = await page.locator('.react-flow__node-construct').first().boundingBox();

  await page.getByRole('menuitem').count(); // menus closed
  await page.getByRole('button', { name: /L→R/ }).click();
  await page.getByRole('menuitem', { name: 'Top to bottom' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/phase1-modeler/tam-top-to-bottom.png' });
  const after = await page.locator('.react-flow__node-construct').first().boundingBox();
  expect(after).not.toEqual(before);

  await page.locator('.sem-canvas').focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Diagram as SVG' }).click();
  const file = await download;
  const path = 'test-results/phase1-modeler/tam.svg';
  await file.saveAs(path);
  const svg = await page.evaluate(
    async (p) => (await fetch(p).catch(() => null))?.status ?? null,
    path,
  );
  expect(svg === null || typeof svg === 'number').toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the project survives a reload (autosave to IndexedDB)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = await openWithTam(page, 'light');
  // Autosave has no success message; it records the project id once IndexedDB has it.
  await page.waitForFunction(() => localStorage.getItem('sem-lab.lastProjectId') !== null, null, {
    timeout: 5000,
  });
  await page.reload();
  await expect(page.locator('.react-flow__node-construct')).toHaveCount(5);
  await expect(page.locator('.react-flow__node-indicator')).toHaveCount(22);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('mobile layout stacks the inspector below the canvas without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWithTam(page, 'light');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/phase1-modeler/tam-mobile.png' });
});

test('a structural path can be drawn with the mouse and an invalid one is refused', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/modeler');
  await page.getByRole('button', { name: 'Use template' }).nth(1).click(); // Two constructs
  await expect(page.locator('.react-flow__node-construct')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge-sem')).toHaveCount(7); // 6 measurement + 1 path

  // Delete the path X → Y via the inspector.
  await page.getByRole('button', { name: 'Show inspector' }).click();
  await page.locator('.sem-canvas').focus();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await inspector.getByRole('button', { name: /^X Reflective/ }).click();
  await inspector.getByRole('button', { name: 'X → Y' }).click();
  await inspector.getByRole('button', { name: 'Delete path' }).click();
  await expect(page.locator('.react-flow__edge-sem')).toHaveCount(6);

  // Redraw it: drag from X's right handle onto Y.
  const x = page.locator('.react-flow__node-construct', { hasText: 'X' });
  const y = page.locator('.react-flow__node-construct', { hasText: 'Y' });
  await x.hover();
  const handle = x.locator('.react-flow__handle-right');
  const hb = (await handle.boundingBox())!;
  const yb = (await y.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(yb.x + yb.width / 2, yb.y + yb.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge-sem')).toHaveCount(7);

  // Drawing the reverse path Y → X is refused (reciprocal paths are not supported).
  await y.hover();
  const h2 = (await y.locator('.react-flow__handle-left').boundingBox())!;
  const xb = (await x.boundingBox())!;
  await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
  await page.mouse.down();
  await page.mouse.move(xb.x + xb.width / 2, xb.y + xb.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge-sem')).toHaveCount(7);
  expect(errors).toEqual([]);
});

test('New model opens a blank canvas that stays blank after leaving the Modeler', async ({
  page,
}) => {
  await page.goto('/modeler');
  await page
    .locator('.modeler-start-card', { hasText: 'Two constructs' })
    .getByRole('button', { name: 'Use template' })
    .click();
  await expect(page.locator('.react-flow__node-construct')).toHaveCount(2);
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New model…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'New model' }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
  await expect(page.locator('.modeler-start')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Workspace' })
    .getByRole('link', { name: 'Data', exact: true })
    .click();
  await page.getByRole('link', { name: 'Modeler', exact: true }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
  await expect(page.locator('.modeler-start')).toHaveCount(0);
});

test('side panels start closed and remember being opened across pages and reloads', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/modeler');
  await page.getByRole('button', { name: 'Use template' }).nth(1).click();
  const palette = page.getByRole('complementary', { name: 'Data indicators', exact: true });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await expect(palette).toHaveCount(0);
  await expect(inspector).toHaveCount(0);

  await page.getByRole('button', { name: 'Show data indicators' }).click();
  await page.getByRole('button', { name: 'Show inspector' }).click();
  await expect(palette).toBeVisible();
  await expect(inspector).toBeVisible();

  await page
    .getByRole('group', { name: 'Workspace' })
    .getByRole('link', { name: 'Data', exact: true })
    .click();
  await page.getByRole('link', { name: 'Modeler', exact: true }).click();
  await expect(palette).toBeVisible();
  await expect(inspector).toBeVisible();

  await page.getByRole('button', { name: 'Hide data indicators' }).click();
  await page.reload();
  await expect(inspector).toBeVisible();
  await expect(palette).toHaveCount(0);
});
