// Validate engine result.json files against the emitted JSON Schema of
// NormalizedSemResult (packages/contracts/schema/normalized-sem-result.json).
//
//   node services/r-engine/tests/validate-result.mjs <result.json> [<result.json> ...]
//
// Uses the ajv already installed for packages/contracts (no new dependency).
// A file with {"ok": true, "result": …} has `result` validated; a file with
// {"ok": false, "error": {code, message}} is checked for the error envelope only.
// Exit 0 = all valid; 1 = at least one invalid (errors printed); 2 = setup problem.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const require = createRequire(resolve(repo, 'packages', 'contracts', 'package.json'));

let Ajv2020;
try {
  ({ Ajv2020 } = require('ajv/dist/2020.js'));
} catch (e) {
  console.error('ajv not found under packages/contracts/node_modules:', e.message);
  process.exit(2);
}

const schema = JSON.parse(
  readFileSync(resolve(repo, 'packages', 'contracts', 'schema', 'normalized-sem-result.json'), 'utf8'),
);
// Same configuration as packages/contracts/tests/contracts.test.ts: formats are
// enforced by the schema's own `pattern` (date-time) and by Zod, not by ajv.
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat('date-time', true);
const validate = ajv.compile({ ...schema, $id: 'normalized-sem-result' });

const CODES = new Set([
  'REQUEST_INVALID', 'DATA_COLUMN_MISSING', 'DATA_NOT_NUMERIC', 'DATA_INSUFFICIENT_ROWS',
  'DATA_ZERO_VARIANCE', 'MODEL_NOT_IDENTIFIED', 'ENGINE_NONCONVERGENCE', 'ENGINE_INADMISSIBLE',
  'CAPABILITY_UNSUPPORTED', 'CANCELLED', 'TIMEOUT', 'ENGINE_INTERNAL',
]);

let bad = 0;
for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8');
  if (/\bNaN\b|\bInfinity\b/.test(text.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) {
    console.error(`${file}: NaN/Infinity literal in JSON`);
    bad++;
    continue;
  }
  const doc = JSON.parse(text);
  if (doc.ok === true) {
    if (!validate(doc.result)) {
      bad++;
      console.error(`${file}: schema errors`);
      for (const err of validate.errors.slice(0, 20)) console.error(`  ${err.instancePath} ${err.message}`);
    }
  } else if (doc.ok === false) {
    const e = doc.error ?? {};
    if (!CODES.has(e.code) || typeof e.message !== 'string' || 'result' in doc) {
      bad++;
      console.error(`${file}: malformed error envelope`);
    }
  } else {
    bad++;
    console.error(`${file}: neither ok:true nor ok:false`);
  }
}
process.exit(bad ? 1 : 0);
