import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AnalysisConfiguration } from '@sem-lab/contracts';
import { estimate } from '@sem-lab/engine';
import { describe, expect, it } from 'vitest';
import { buildAnalysisData } from '@/domain/dataset/analysis-data';
import { loadBundledCsv, bundledDatasetInfo } from '@/domain/dataset/bundled';
import { profileDataset } from '@/domain/dataset/stats';
import { createDataset, isDatasetError } from '@/domain/dataset/transform';
import { validate, hasBlockingIssues } from '@/domain/validation/validate';
import { dataSummary } from '@/features/data-lab/readiness';
import { configFromAnalysis, toConfiguration } from '@/features/analysis/config';
import { EXAMPLES, parseExample } from './examples';

const DIR = join(__dirname, '..', '..', '..', '..', '..', 'content', 'examples');
const ids = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

describe('example content', () => {
  it('finds every file in content/examples', () => {
    expect(ids).toHaveLength(10);
    expect(EXAMPLES.map((e) => e.id).sort()).toEqual([...ids].sort());
  });

  it.each(ids)("%s: a saved layout places exactly the model's constructs and indicators", (id) => {
    const ex = parseExample(JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')));
    if (!ex.layout) return; // automatic layout
    const nodeIds = [
      ...ex.model.constructs.map((c) => c.id),
      ...ex.model.indicators.map((i) => i.id),
    ];
    expect(Object.keys(ex.layout.nodes).sort()).toEqual(nodeIds.sort());
  });

  it.each(ids)(
    '%s: parses, has its dataset, validates and estimates',
    async (id) => {
      const ex = parseExample(JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')));
      expect(ex.id).toBe(id);
      expect(ex.analysis.engine).toBe('browser');
      expect(bundledDatasetInfo(ex.dataset.bundledId)).toBeDefined();

      const ds = await createDataset(await loadBundledCsv(ex.dataset.bundledId), {
        name: id,
        source: { kind: 'bundled', exampleId: ex.dataset.bundledId },
      });
      if (isDatasetError(ds)) throw new Error(ds.error.message);

      const issues = validate({
        model: ex.model,
        analysis: ex.analysis,
        data: dataSummary(ex.model, ds, profileDataset(ds)),
      });
      expect(
        issues.filter((i) => i.severity === 'error'),
        JSON.stringify(issues.map((i) => i.code)),
      ).toEqual([]);
      expect(hasBlockingIssues(issues)).toBe(false);

      const analysis: AnalysisConfiguration = ex.analysis.bootstrap?.enabled
        ? { ...ex.analysis, bootstrap: { ...ex.analysis.bootstrap, repetitions: 20 } }
        : ex.analysis;
      const data = buildAnalysisData(
        ex.model,
        ds,
        analysis.missingData === 'fiml' ? 'fiml' : 'listwise',
      );
      if ('error' in data) throw new Error(data.error.message);
      const out = await estimate({
        model: ex.model,
        analysis,
        data: {
          columns: data.columns,
          rows: data.rows as number[][],
          nRows: data.nRows,
          nDropped: data.nDropped,
        },
      });
      expect(out.ok, out.ok ? '' : out.error.message).toBe(true);
    },
    120_000,
  );

  it.each(ids)('%s: the analysis survives the config form round trip', (id) => {
    const ex = parseExample(JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')));
    const back = toConfiguration(configFromAnalysis(ex.analysis));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.analysis).toEqual(ex.analysis);
  });
});
