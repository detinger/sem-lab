/**
 * Validates every Learn / Challenge / Reference content file against ./schema.ts and checks
 * cross-references: prerequisites, glossary ids, citation keys, example ids, bundled datasets,
 * model-check keys; and recomputes every numeric answer key that states a derivation with the
 * browser engine (the numbers students are scored against must be what the app shows).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type NormalizedSemResult, SemModel } from '@sem-lab/contracts';
import { estimate } from '@sem-lab/engine';
import { registry } from '@sem-lab/method-registry';
import { describe, expect, it } from 'vitest';
import { buildAnalysisData } from '@/domain/dataset/analysis-data';
import { bundledDatasetInfo } from '@/domain/dataset/bundled';
import { createDataset, isDatasetError } from '@/domain/dataset/transform';
import {
  Challenge,
  Citations,
  type Derivation,
  Glossary,
  Lesson,
  type Starter,
  Theories,
} from './schema';

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const C = join(REPO, 'content');
const json = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
const files = (dir: string): string[] =>
  existsSync(join(C, dir))
    ? readdirSync(join(C, dir))
        .filter((f) => f.endsWith('.json'))
        .sort()
    : [];

const lessons = files('lessons').map((f) => ({ f, l: Lesson.parse(json(join(C, 'lessons', f))) }));
const challenges = files('challenges').map((f) => ({
  f,
  c: Challenge.parse(json(join(C, 'challenges', f))),
}));
const glossary = existsSync(join(C, 'reference', 'glossary.json'))
  ? Glossary.parse(json(join(C, 'reference', 'glossary.json'))).terms
  : [];
const theories = existsSync(join(C, 'reference', 'theories.json'))
  ? Theories.parse(json(join(C, 'reference', 'theories.json'))).theories
  : [];
const contentCitations = existsSync(join(C, 'citations', 'citations.json'))
  ? Citations.parse(json(join(C, 'citations', 'citations.json'))).citations
  : [];
const exampleIds = new Set(files('examples').map((f) => f.replace(/\.json$/, '')));
const lessonIds = new Set(lessons.map(({ l }) => l.id));
const glossaryIds = new Set(glossary.map((t) => t.id));
const citationKeys = new Set([
  ...registry.citations.map((c) => c.key),
  ...contentCitations.map((c) => c.key),
]);

const GLOSSARY_LINK = /\[\[([a-z0-9-]+)\]\]/g;
function textsOf(o: unknown): string[] {
  if (typeof o === 'string') return [o];
  if (Array.isArray(o)) return o.flatMap(textsOf);
  if (o && typeof o === 'object') return Object.values(o).flatMap(textsOf);
  return [];
}
function checkStarter(s: Starter | undefined, where: string): void {
  if (!s) return;
  if (s.exampleId)
    expect(exampleIds.has(s.exampleId), `${where}: example ${s.exampleId}`).toBe(true);
  if (s.bundledDatasetId)
    expect(
      bundledDatasetInfo(s.bundledDatasetId),
      `${where}: dataset ${s.bundledDatasetId}`,
    ).toBeDefined();
}

describe('content files', () => {
  it('file names follow the convention and ids are unique', () => {
    for (const { f, l } of lessons)
      expect(f).toBe(`L${l.level}-${String(l.order).padStart(2, '0')}-${l.id}.json`);
    for (const { f, c } of challenges)
      expect(f).toBe(`C${String(c.number).padStart(2, '0')}-${c.id}.json`);
    expect(lessonIds.size).toBe(lessons.length);
    expect(new Set(challenges.map(({ c }) => c.id)).size).toBe(challenges.length);
    expect(glossaryIds.size).toBe(glossary.length);
    expect(new Set(contentCitations.map((c) => c.key)).size).toBe(contentCitations.length);
    for (const c of contentCitations)
      expect(
        registry.citations.some((r) => r.key === c.key),
        `citation key ${c.key} clashes with the registry`,
      ).toBe(false);
  });

  it('lessons: prerequisites, glossary, references and starters resolve', () => {
    for (const { l } of lessons) {
      for (const p of l.prerequisites)
        expect(lessonIds.has(p), `${l.id} prerequisite ${p}`).toBe(true);
      for (const g of l.glossary) expect(glossaryIds.has(g), `${l.id} glossary ${g}`).toBe(true);
      for (const r of l.references)
        expect(citationKeys.has(r), `${l.id} reference ${r}`).toBe(true);
      checkStarter(l.tryIt?.starter, l.id);
      expect(
        l.body.filter((b) => b.kind === 'formula').length,
        `${l.id}: at most one formula`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('challenges: numbering, prerequisites, starters and model-check keys resolve', () => {
    challenges.forEach(({ c }, i) => expect(c.number).toBe(i + 1));
    for (const { c } of challenges) {
      for (const p of c.prerequisiteLessons)
        expect(lessonIds.has(p), `${c.id} prerequisite ${p}`).toBe(true);
      if (c.nextLesson)
        expect(lessonIds.has(c.nextLesson), `${c.id} next ${c.nextLesson}`).toBe(true);
      checkStarter(c.starter, c.id);
      for (const t of c.tasks) {
        if (t.kind === 'model') {
          const keys = new Set(t.check.constructs.map((k) => k.key));
          for (const [a, b] of t.check.paths) {
            expect(keys.has(a), `${c.id}/${t.id} path from ${a}`).toBe(true);
            expect(keys.has(b), `${c.id}/${t.id} path to ${b}`).toBe(true);
          }
        }
        if (t.kind === 'choice' && !t.multiple)
          expect(t.options.filter((o) => o.correct).length, `${c.id}/${t.id}`).toBe(1);
      }
    }
  });

  it('every [[glossary]] link in any text resolves', () => {
    const all = [
      ...lessons.map(({ l }) => l),
      ...challenges.map(({ c }) => c),
      ...glossary,
      ...theories,
    ];
    for (const item of all)
      for (const t of textsOf(item))
        for (const m of t.matchAll(GLOSSARY_LINK))
          expect(glossaryIds.has(m[1]!), `[[${m[1]}]] in ${(item as { id: string }).id}`).toBe(
            true,
          );
  });

  it('glossary and theories cross-references resolve', () => {
    for (const t of glossary) {
      for (const l of t.lessons) expect(lessonIds.has(l), `${t.id} lesson ${l}`).toBe(true);
      for (const s of t.seeAlso) expect(glossaryIds.has(s), `${t.id} see also ${s}`).toBe(true);
    }
    for (const th of theories) {
      for (const r of th.references)
        expect(citationKeys.has(r), `${th.id} reference ${r}`).toBe(true);
      for (const e of th.examples) expect(exampleIds.has(e), `${th.id} example ${e}`).toBe(true);
      for (const n of th.notebooks)
        expect(existsSync(join(REPO, 'notebooks', 'colab', n)), `${th.id} notebook ${n}`).toBe(
          true,
        );
    }
  });
});

// ---- numeric answer keys ------------------------------------------------------------------

async function runDerivation(d: Derivation): Promise<NormalizedSemResult> {
  let model: SemModel;
  let csv: string;
  if (d.source.fixture) {
    const dir = join(REPO, 'packages', 'fixtures', 'synthetic', d.source.fixture);
    model = SemModel.parse(json(join(dir, 'model.json')));
    csv = readFileSync(join(dir, 'data.csv'), 'utf8');
  } else {
    const ex = json(join(C, 'examples', `${d.source.exampleId}.json`)) as {
      model: unknown;
      dataset: { bundledId: string };
    };
    model = SemModel.parse(ex.model);
    const id = ex.dataset.bundledId;
    const p =
      id === 'acsi-2015'
        ? join(REPO, 'packages/fixtures/third-party/smartpls-samples/acsi-2015/data.csv')
        : join(REPO, 'packages/fixtures/synthetic', id, 'data.csv');
    csv = readFileSync(p, 'utf8');
  }
  const ds = await createDataset(csv, {
    name: 'd',
    source: { kind: 'file', fileName: 'data.csv' },
  });
  if (isDatasetError(ds)) throw new Error(ds.error.message);
  const data = buildAnalysisData(
    model,
    ds,
    d.analysis.missingData === 'fiml' ? 'fiml' : 'listwise',
  );
  if ('error' in data) throw new Error(data.error.message);
  const out = await estimate({
    model,
    analysis: { ...d.analysis, engine: 'browser' },
    data: {
      columns: data.columns,
      rows: data.rows as number[][],
      nRows: data.nRows,
      nDropped: data.nDropped,
    },
  });
  if (!out.ok) throw new Error(out.error.message);
  return out.result;
}

function valueOf(r: NormalizedSemResult, d: Derivation): number | null | undefined {
  if (d.parameterKey) {
    const p = r.parameters.find(
      (x) =>
        x.key === d.parameterKey &&
        (r.parameters.some((y) => y.scale === 'unstandardized')
          ? x.scale === 'unstandardized'
          : true),
    );
    return p?.[d.field ?? 'est'];
  }
  if (d.constructMetric)
    return r.constructMetrics.find(
      (m) =>
        m.constructId === d.constructMetric!.constructId && m.metric === d.constructMetric!.metric,
    )?.value;
  if (d.fitIndex) return r.fit.find((f) => f.name === d.fitIndex)?.value;
  if (d.ipma)
    return r.ipma?.constructs.find((c) => c.constructId === d.ipma!.constructId)?.[d.ipma.value];
  return undefined;
}

const numberTasks = challenges.flatMap(({ c }) =>
  c.tasks.flatMap((t) =>
    t.kind === 'number' && t.derivation ? [{ id: `${c.id}/${t.id}`, t }] : [],
  ),
);

describe.skipIf(numberTasks.length === 0)(
  'numeric answer keys reproduce with the browser engine',
  () => {
    it.each(numberTasks)(
      '$id',
      async ({ t }) => {
        if (t.kind !== 'number' || !t.derivation) return;
        const r = await runDerivation(t.derivation);
        const v = valueOf(r, t.derivation);
        expect(v, 'derivation does not point at a value').toEqual(expect.any(Number));
        // the stored answer must lie well inside its own tolerance band around the engine value
        expect(Math.abs((v as number) - t.answer)).toBeLessThanOrEqual(t.tolerance / 2);
      },
      120_000,
    );
  },
);

/** The `initial` keys each demo component reads (apps/web/src/features/learn/demos). */
const DEMO_KEYS: Record<string, readonly string[]> = {
  'reliability-from-loadings': ['loadings'],
  htmt: ['heterotrait', 'monotraitA', 'monotraitB'],
  vif: ['r2'],
  f2: ['r2Included', 'r2Excluded'],
  mediation: ['a', 'b', 'cPrime', 'indirectSignificant', 'directSignificant'],
  bootstrap: ['statistic', 'draws', 'seed'],
  'ipma-rescale': ['min', 'max', 'observedMin', 'observedMax', 'mean'],
  'rmsea-cfi': ['chisq', 'df', 'n', 'baselineChisq', 'baselineDf'],
  'reflective-formative': ['mode'],
};

describe('demo starting values', () => {
  it('every key a lesson or challenge sets is one its demo reads', () => {
    const demos: Array<{ where: string; demo: string; keys: string[] }> = [];
    const walk = (o: unknown, where: string): void => {
      if (Array.isArray(o)) o.forEach((x) => walk(x, where));
      else if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>;
        if (r.kind === 'demo')
          demos.push({
            where,
            demo: r.demo as string,
            keys: Object.keys((r.initial as object) ?? {}),
          });
        Object.values(r).forEach((x) => walk(x, where));
      }
    };
    lessons.forEach(({ l }) => walk(l, l.id));
    challenges.forEach(({ c }) => walk(c, c.id));
    for (const d of demos)
      for (const k of d.keys)
        expect(DEMO_KEYS[d.demo], `${d.where}: ${d.demo} does not read "${k}"`).toContain(k);
  });
});
