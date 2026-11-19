import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const OUT = 'test-results/phase4-browser';
export const REPO = join(process.cwd(), '..', '..');

export const fixtureModel = (id: string): unknown =>
  JSON.parse(readFileSync(join(REPO, 'packages/fixtures/synthetic', id, 'model.json'), 'utf8'));
export const exampleModel = (id: string): { model: unknown; analysis: Record<string, unknown> } =>
  JSON.parse(readFileSync(join(REPO, 'content/examples', `${id}.json`), 'utf8')) as {
    model: unknown;
    analysis: Record<string, unknown>;
  };

/** Watch for errors and for any request that could carry data off the device. */
export function watch(page: Page): { errors: string[]; uploads: string[] } {
  const errors: string[] = [];
  const uploads: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() !== 'GET' && r.method() !== 'HEAD') uploads.push(`${r.method()} ${r.url()}`);
    else if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http'))
      uploads.push(`GET ${r.url()}`);
  });
  return { errors, uploads };
}

export async function setup(page: Page, theme: 'light' | 'dark', width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.addInitScript((value) => {
    window.localStorage.setItem('sem-lab:theme', value);
  }, theme);
}

export async function expandLayout(page: Page) {
  await page.addStyleTag({
    content: `.shell, .shell__column, .shell__main { height: auto !important; max-height: none !important; overflow: visible !important; }`,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

type Hook = {
  loadModel: (m: unknown, name?: string) => Promise<void>;
  lastRun: () => { status: string; durationMs: number | null; result: unknown } | null;
  setWorkers: (n: number | null) => void;
};

/** Open a model through the dev hook, then load a bundled sample from the Data page (in-app navigation). */
export async function openModelAndSample(page: Page, model: unknown, sample: RegExp) {
  await page.goto('/modeler');
  await page.waitForFunction(() =>
    Boolean((window as unknown as Record<string, unknown>).__semLabTest),
  );
  await page.evaluate(
    (m) => (window as unknown as { __semLabTest: Hook }).__semLabTest.loadModel(m),
    model,
  );
  await page.getByRole('link', { name: 'Data', exact: true }).click();
  await page.getByRole('button', { name: /Use sample dataset/ }).click();
  await page.getByRole('menuitem', { name: sample }).click();
  await expect(page.getByRole('region', { name: 'Preview of the working table' })).toBeVisible();
}

export const lastRun = (page: Page) =>
  page.evaluate(() => (window as unknown as { __semLabTest: Hook }).__semLabTest.lastRun());

/** Everything except the wall-clock timestamps, which differ between runs. */
export const canonical = (o: unknown): string =>
  JSON.stringify(o, (k, v: unknown) => (k === 'startedAt' || k === 'finishedAt' ? 'T' : v));
