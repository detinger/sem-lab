import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import {
  AnalysisConfiguration,
  AnalysisRun,
  DatasetRef,
  NormalizedSemResult,
  SemLayout,
  SemModel,
  SemProject,
  canonicalJson,
  dataFingerprint,
  measurementEdges,
  modelHash,
  sha256Hex,
  validateModelStructure,
} from '../src/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(root, p), 'utf8'));

const zodByContract: Record<string, ZodType> = {
  'sem-model': SemModel,
  'sem-layout': SemLayout,
  'dataset-ref': DatasetRef,
  'analysis-configuration': AnalysisConfiguration,
  'normalized-sem-result': NormalizedSemResult,
  'sem-project': SemProject,
  'analysis-run': AnalysisRun,
};
const contractOfValidFile: Record<string, string> = {
  model: 'sem-model',
  layout: 'sem-layout',
  analysis: 'analysis-configuration',
  project: 'sem-project',
  result: 'normalized-sem-result',
};

const ajv = new Ajv2020({ strict: false, allErrors: true });
// Zod emits `format` keywords (date-time, …); shape tests only, formats are Zod's job.
ajv.addFormat('date-time', true);
const jsonSchemaValidator = (contract: string) =>
  ajv.getSchema(contract) ??
  ajv.compile({ ...(readJson(`schema/${contract}.json`) as object), $id: contract });

describe('valid examples', () => {
  for (const file of readdirSync(join(root, 'examples/valid'))) {
    const contract = contractOfValidFile[file.split('.')[0] ?? ''];
    it(`${file} is accepted by Zod and by the emitted JSON Schema`, () => {
      expect(contract, `no contract mapping for ${file}`).toBeDefined();
      const doc = readJson(`examples/valid/${file}`);
      const parsed = zodByContract[contract!]!.safeParse(doc);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      const validate = jsonSchemaValidator(contract!);
      expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
    });
  }
});

describe('invalid examples', () => {
  const files = readdirSync(join(root, 'examples/invalid'));
  for (const file of files.filter((f) => !f.startsWith('structure.'))) {
    const ex = readJson(`examples/invalid/${file}`) as {
      contract: string;
      catchesBy: 'schema' | 'refinement';
      document: unknown;
    };
    it(`${file} is rejected by Zod`, () => {
      expect(zodByContract[ex.contract]!.safeParse(ex.document).success).toBe(false);
    });
    it(`${file}: JSON Schema ${ex.catchesBy === 'schema' ? 'rejects it too' : 'cannot see the cross-field rule (documented gap)'}`, () => {
      expect(jsonSchemaValidator(ex.contract)(ex.document)).toBe(ex.catchesBy !== 'schema');
    });
  }
  for (const file of files.filter((f) => f.startsWith('structure.'))) {
    const ex = readJson(`examples/invalid/${file}`) as {
      document: unknown;
      expectedCodes: string[];
    };
    it(`${file} passes the schema but fails structural validation with exactly ${ex.expectedCodes.join(', ')}`, () => {
      const model = SemModel.parse(ex.document);
      expect([...new Set(validateModelStructure(model).map((i) => i.code))].sort()).toEqual(
        [...ex.expectedCodes].sort(),
      );
    });
  }
});

describe('structural validation', () => {
  it('accepts the TAM reference model', () => {
    expect(
      validateModelStructure(SemModel.parse(readJson('examples/valid/model.tam-v1.json'))),
    ).toEqual([]);
  });
});

describe('derived measurement edges', () => {
  const model = SemModel.parse(readJson('examples/valid/model.tam-v1.json'));
  it('derives one arrow per block member, construct → indicator for reflective blocks', () => {
    const edges = measurementEdges(model);
    expect(edges).toHaveLength(model.indicators.length);
    expect(edges.every((e) => e.direction === 'construct-to-indicator')).toBe(true);
    expect(edges[0]?.id).toBe(
      `meas:${model.constructs[0]?.id}:${model.constructs[0]?.indicatorIds[0]}`,
    );
  });
  it('flips every arrow of a block when the block becomes composite-formative', () => {
    const flipped = {
      ...model,
      constructs: model.constructs.map((c, i) =>
        i === 0 ? { ...c, measurement: 'composite-formative' as const } : c,
      ),
    };
    const first = model.constructs[0]!;
    const edges = measurementEdges(flipped).filter((e) => e.constructId === first.id);
    expect(edges.map((e) => e.direction)).toEqual(
      first.indicatorIds.map(() => 'indicator-to-construct'),
    );
  });
});

describe('canonical JSON and hashing', () => {
  const vectors = readJson('examples/hash/vectors.json') as Array<{
    name: string;
    input: unknown;
    canonical: string;
    sha256: string;
  }>;
  for (const v of vectors) {
    it(`vector "${v.name}" serialises and hashes as specified`, async () => {
      expect(canonicalJson(v.input)).toBe(v.canonical);
      expect(await sha256Hex(canonicalJson(v.input))).toBe(v.sha256);
    });
  }
  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson([Number.POSITIVE_INFINITY])).toThrow(/non-finite/);
  });

  const model = SemModel.parse(readJson('examples/valid/model.tam-v1.json'));
  it('modelHash ignores element order, labels and hypothesis tags', async () => {
    const reordered = {
      constructs: [...model.constructs]
        .reverse()
        .map((c) => ({ ...c, label: 'renamed long label' })),
      indicators: [...model.indicators].reverse(),
      relationships: [...model.relationships].reverse().map((r) => ({ ...r, hypothesis: 'H99' })),
    };
    expect(await modelHash(reordered)).toBe(await modelHash(model));
  });
  it('modelHash changes when the specification changes', async () => {
    const base = await modelHash(model);
    const renamed = {
      ...model,
      constructs: model.constructs.map((c, i) => (i === 0 ? { ...c, name: 'PEOU2' } : c)),
    };
    const reorderedBlock = {
      ...model,
      constructs: model.constructs.map((c, i) =>
        i === 0 ? { ...c, indicatorIds: [...c.indicatorIds].reverse() } : c,
      ),
    };
    const fewerPaths = { ...model, relationships: model.relationships.slice(1) };
    const rescaled = {
      ...model,
      indicators: model.indicators.map((x, i) =>
        i === 0 ? { ...x, scale: { min: 0, max: 7 } } : x,
      ),
    };
    for (const changed of [renamed, reorderedBlock, fewerPaths, rescaled]) {
      expect(await modelHash(changed)).not.toBe(base);
    }
  });
  it('dataFingerprint depends on values and order, not on source formatting', async () => {
    const cols = ['a', 'b'];
    const fp = await dataFingerprint(cols, [
      [7, 1.5],
      [null, 'x'],
    ]);
    expect(
      await dataFingerprint(cols, [
        [7.0, 1.5],
        [null, 'x'],
      ]),
    ).toBe(fp);
    expect(
      await dataFingerprint(cols, [
        [null, 'x'],
        [7, 1.5],
      ]),
    ).not.toBe(fp);
    await expect(dataFingerprint(cols, [[1]])).rejects.toThrow(/expected 2/);
  });
});
