/**
 * Emit JSON Schema (draft 2020-12) for every top-level contract into ../schema/.
 *   node scripts/emit-json-schema.ts           write files
 *   node scripts/emit-json-schema.ts --check   exit 1 if a committed file is stale
 *
 * Note: Zod refinements (.refine/.superRefine) are not representable in JSON Schema. The
 * emitted schema checks shape only; cross-field rules are enforced by Zod and mirrored in
 * Pydantic. The drift tests in tests/examples.test.ts document which invalid examples
 * only the refinements catch.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  AnalysisConfiguration,
  AnalysisRun,
  DatasetRef,
  NormalizedSemResult,
  SemLayout,
  SemModel,
  SemProject,
} from '../src/index.ts';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema');
const contracts = {
  'sem-model': SemModel,
  'sem-layout': SemLayout,
  'dataset-ref': DatasetRef,
  'analysis-configuration': AnalysisConfiguration,
  'normalized-sem-result': NormalizedSemResult,
  'sem-project': SemProject,
  'analysis-run': AnalysisRun,
} as const;

const check = process.argv.includes('--check');
let stale = 0;
mkdirSync(outDir, { recursive: true });
for (const [name, schema] of Object.entries(contracts)) {
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
    io: 'input',
  });
  const text = `${JSON.stringify({ $id: `https://sem-lab.local/schema/${name}.json`, title: name, ...json }, null, 2)}\n`;
  const file = join(outDir, `${name}.json`);
  if (check) {
    let current = '';
    try {
      current = readFileSync(file, 'utf8');
    } catch {
      /* missing counts as stale */
    }
    if (current !== text) {
      console.error(`stale: schema/${name}.json`);
      stale++;
    }
  } else {
    writeFileSync(file, text);
    console.log(`wrote schema/${name}.json`);
  }
}
if (stale > 0) {
  console.error(
    `${stale} schema file(s) out of date — run: npm run emit-schema --workspace @sem-lab/contracts`,
  );
  process.exit(1);
}
