import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACSI_ATTRIBUTION,
  BUNDLED_DATASETS,
  bundledDatasetInfo,
  loadBundledCsv,
  loadBundledDataset,
} from './bundled';

const FIXTURES = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'fixtures');
const SYNTHETIC = join(FIXTURES, 'synthetic');

describe('bundled example datasets', () => {
  it('lists every synthetic case that has data, matching its manifest, labelled SYNTHETIC', () => {
    const cases = readdirSync(SYNTHETIC).filter((d) => existsSync(join(SYNTHETIC, d, 'data.csv')));
    const synthetic = BUNDLED_DATASETS.filter((d) => d.synthetic);
    expect(synthetic.map((d) => d.id).sort()).toEqual([...cases].sort());
    for (const d of synthetic) {
      const m = JSON.parse(readFileSync(join(SYNTHETIC, d.id, 'manifest.json'), 'utf8')) as {
        title: string;
        n: number;
        nColumns: number;
        synthetic: boolean;
      };
      expect(m.synthetic).toBe(true);
      expect(d.title).toBe(`${m.title} (SYNTHETIC)`);
      expect([d.rows, d.columns]).toEqual([m.n, m.nColumns]);
      expect(d.provenance.synthetic).toBe(true);
    }
  });

  it('ships only ACSI 2015 among the third-party data, with the exact PROVENANCE attribution', () => {
    const thirdParty = BUNDLED_DATASETS.filter((d) => !d.synthetic);
    expect(thirdParty.map((d) => d.id)).toEqual(['acsi-2015']);
    const provenance = readFileSync(
      join(FIXTURES, 'third-party', 'smartpls-samples', 'PROVENANCE.md'),
      'utf8',
    );
    expect(provenance).toContain(`**Required attribution:** ${ACSI_ATTRIBUTION}`);
    expect(bundledDatasetInfo('acsi-2015')?.provenance).toEqual({
      synthetic: false,
      licence: 'CC BY 4.0',
      attribution: ACSI_ATTRIBUTION,
    });
    for (const id of ['tam', 'utaut', 'oi', 'concise-guide', 'hbat'])
      expect(bundledDatasetInfo(id)).toBeUndefined();
  });

  it('loads the raw text through the lazy ?raw imports', async () => {
    const text = await loadBundledCsv('pls-two-construct');
    expect(text).toBe(readFileSync(join(SYNTHETIC, 'pls-two-construct', 'data.csv'), 'utf8'));
    await expect(loadBundledCsv('tam')).rejects.toThrow(/Unknown bundled dataset/);
  });

  it('every bundled dataset loads as a fully numeric Dataset of the stated size', async () => {
    for (const info of BUNDLED_DATASETS) {
      const ds = await loadBundledDataset(info.id, {
        datasetId: 'd',
        importedAt: '2026-11-19T00:00:00Z',
      });
      expect(ds.source).toEqual({ kind: 'bundled', exampleId: info.id });
      expect([ds.rowIndex.length, ds.columns.length], info.id).toEqual([info.rows, info.columns]);
      expect(ds.parse.issues, info.id).toEqual([]);
      expect(
        ds.columns.every((c) => c.kind === 'numeric'),
        info.id,
      ).toBe(true);
    }
  });
});
