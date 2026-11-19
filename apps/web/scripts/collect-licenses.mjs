// Reads the license of every direct dependency from its installed package.json and writes
// docs/validation/phase-0/evidence/web/licenses.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webRoot, '../..');
const manifest = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8'));

/** @param {string} name */
function installed(name) {
  for (const base of [webRoot, repoRoot]) {
    const file = join(base, 'node_modules', name, 'package.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  }
  throw new Error(`${name} is not installed`);
}

const rows = [];
for (const group of ['dependencies', 'devDependencies']) {
  for (const name of Object.keys(manifest[group] ?? {}).sort()) {
    const pkg = installed(name);
    const license =
      typeof pkg.license === 'string'
        ? pkg.license
        : JSON.stringify(pkg.license ?? pkg.licenses ?? 'unknown');
    rows.push({ name, group, version: pkg.version, license });
  }
}
const dir = join(repoRoot, 'docs/validation/phase-0/evidence/web');
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'licenses.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), packages: rows }, null, 2)}\n`,
);
console.log(
  rows
    .map(
      (r) => `${r.group === 'dependencies' ? 'dep' : 'dev'}\t${r.name}\t${r.version}\t${r.license}`,
    )
    .join('\n'),
);
