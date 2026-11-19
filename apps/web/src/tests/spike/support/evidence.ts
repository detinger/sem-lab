/**
 * Evidence files for docs/validation/phase-0. Tests always assert; they only WRITE the
 * measurement files when SEM_WRITE_EVIDENCE=1 (npm run spike:evidence -w @sem-lab/web), so an
 * ordinary test run never dirties the working tree with new timings.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** apps/web */
export const webRoot = resolve(here, '../../../..');
/** repository root */
export const repoRoot = resolve(webRoot, '../..');

const evidenceDir = join(repoRoot, 'docs/validation/phase-0/evidence/web');

export const evidenceEnabled = process.env.SEM_WRITE_EVIDENCE === '1';

/** Version and license of an installed package, read from its own package.json. */
export function installedPackage(name: string): { name: string; version: string; license: string } {
  for (const base of [webRoot, repoRoot]) {
    const file = join(base, 'node_modules', name, 'package.json');
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version?: string; license?: string };
      return { name, version: pkg.version ?? 'unknown', license: pkg.license ?? 'unknown' };
    }
  }
  throw new Error(`Package ${name} is not installed`);
}

export function writeEvidence(fileName: string, packages: string[], data: unknown): void {
  if (!evidenceEnabled) {
    return;
  }
  mkdirSync(evidenceDir, { recursive: true });
  const document = {
    generatedAt: new Date().toISOString(),
    generatedBy: 'apps/web/src/tests/spike (npm run spike:evidence -w @sem-lab/web)',
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    packages: packages.map(installedPackage),
    data,
  };
  // JSON.stringify would silently turn NaN/Infinity into null; refuse instead (ground rule 5).
  const text = JSON.stringify(
    document,
    (_key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error(`Non-finite number in evidence file ${fileName}`);
      }
      return value;
    },
    2,
  );
  writeFileSync(join(evidenceDir, fileName), `${text}\n`, 'utf8');
}
