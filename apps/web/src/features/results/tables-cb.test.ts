import { describe, expect, it } from 'vitest';
import { cbFixture } from '../analysis/test-support';
import { toHtml } from '../reports/table';
import {
  type CbScale,
  type TableContext,
  cbCorrelationsTable,
  cbCovariancesTable,
  cbDiagnostics,
  cbFitTable,
  cbLoadingsTable,
  cbPathsTable,
  cbR2Table,
  cbResidualsTable,
  scaleLegend,
} from './tables';

const ctxOf = (
  name: Parameters<typeof cbFixture>[0],
  scale: CbScale = 'standardized',
): TableContext => {
  const f = cbFixture(name);
  return { model: f.model, result: f.result, analysis: f.analysis, scale };
};
const row = (t: { rows: Array<Record<string, string>> }, key: string, value: string) =>
  t.rows.find((r) => r[key] === value)!;

describe('CB-SEM fit table', () => {
  it('lists χ², df, p, CFI, TLI, RMSEA with its 90% CI, SRMR, AIC and BIC from the real ML result', () => {
    const t = cbFitTable(ctxOf('cb-service-quality-ml'));
    const names = t.rows.map((r) => r.m);
    expect(names).toEqual([
      'χ²',
      'df',
      'p (χ² test)',
      'CFI',
      'TLI',
      'RMSEA [90% CI]',
      'SRMR',
      'AIC',
      'BIC',
    ]);
    const { result } = cbFixture('cb-service-quality-ml');
    const chisq = result.fit.find((f) => f.name === 'chisq')!.value!;
    expect(row(t, 'm', 'χ²').v).toBe(chisq.toFixed(3));
    expect(row(t, 'm', 'df').v).toBe('62');
    expect(row(t, 'm', 'RMSEA [90% CI]').ci).toMatch(/^\[0\.000, 0\.0\d\d\]$/);
    expect(t.notes.join(' ')).toContain('No universal cut-offs');
  });

  it('labels scaled and robust variants (MLR) next to the standard ones', () => {
    const t = cbFitTable(ctxOf('cb-service-quality-mlr'));
    const names = t.rows.map((r) => r.m);
    expect(names).toEqual(
      expect.arrayContaining([
        'χ²',
        'χ² (scaled)',
        'χ² scaling factor (scaled)',
        'CFI',
        'CFI (scaled)',
        'CFI (robust)',
        'RMSEA (robust) [90% CI]',
        'RMSEA (scaled) [90% CI]',
      ]),
    );
    expect(t.notes.join(' ')).toContain('(scaled) = Yuan–Bentler');
  });

  it('shows not-applicable values as an en dash and gives the reason (just-identified model)', () => {
    const t = cbFitTable(ctxOf('cb-heywood'));
    expect(row(t, 'm', 'CFI').v).toBe('–');
    expect(row(t, 'm', 'RMSEA').v).toBe('–');
    expect(row(t, 'm', 'df').v).toBe('0');
    expect(t.notes.join(' ')).toMatch(
      /not applicable to this construct or relation \(the model is just-identified, df = 0\)/,
    );
  });
});

describe('CB-SEM parameter tables follow the scale toggle', () => {
  const { result } = cbFixture('cb-service-quality-ml');
  const loading = (scale: CbScale, ind: string) =>
    result.parameters.find((p) => p.kind === 'loading' && p.targetId === ind && p.scale === scale)!;

  it('loadings: selected scale first, labels change, SE/z/p only for unstandardized', () => {
    const std = cbLoadingsTable(ctxOf('cb-service-quality-ml', 'standardized'));
    const un = cbLoadingsTable(ctxOf('cb-service-quality-ml', 'unstandardized'));
    expect(std.columns.map((c) => c.label)).toEqual([
      'Factor',
      'Indicator',
      'Standardized loading',
      'SE',
      'z',
      'p',
      '95% CI',
      'Unstandardized loading',
    ]);
    expect(un.columns[2]!.label).toBe('Unstandardized loading');
    expect(un.columns[7]!.label).toBe('Standardized loading');
    expect(std.title).toContain('standardized');
    expect(un.title).toContain('unstandardized');
    const s = loading('standardized', 'i_sq2');
    const u = loading('unstandardized', 'i_sq2');
    const stdRow = row(std, 'i', 'sq2');
    const unRow = row(un, 'i', 'sq2');
    expect(stdRow.est).toBe(s.est!.toFixed(3));
    expect(unRow.est).toBe(u.est!.toFixed(3));
    expect(stdRow.se).toBe('–');
    expect(unRow.se).toBe(u.se!.toFixed(3));
    expect(unRow.z).toBe(u.statistic!.toFixed(2));
    expect(stdRow.alt).toBe(u.est!.toFixed(3));
    // the marker loading is fixed at 1 and says so
    expect(row(un, 'i', 'sq1').est).toBe('1.000 (fixed)');
    expect(un.notes.join(' ')).toContain('Fixed parameters');
    expect(un.notes.join(' ')).toContain('expected information');
  });

  it('paths: standardized β vs unstandardized B with the analytic inference note', () => {
    const std = cbPathsTable(ctxOf('cb-service-quality-ml', 'standardized'));
    const un = cbPathsTable(ctxOf('cb-service-quality-ml', 'unstandardized'));
    const key = 'path:c_sq->c_sat';
    const s = result.parameters.find((p) => p.key === key && p.scale === 'standardized')!;
    const u = result.parameters.find((p) => p.key === key && p.scale === 'unstandardized')!;
    expect(std.columns[1]!.label).toBe('β (standardized)');
    expect(un.columns[1]!.label).toBe('B (unstandardized)');
    expect(std.rows[0]!.est).toBe(s.est!.toFixed(3));
    expect(un.rows[0]!.est).toBe(u.est!.toFixed(3));
    expect(un.rows[0]!.p).not.toBe('–');
    expect(std.rows[0]!.p).toBe('–');
    expect(un.notes.join(' ')).toContain('No bootstrap was run');
    expect(std.notes.join(' ')).toContain('not computed for standardized');
  });

  it('MLR names the robust sandwich standard errors', () => {
    const t = cbPathsTable(ctxOf('cb-service-quality-mlr', 'unstandardized'));
    expect(t.notes.join(' ')).toContain('robust (Huber–White sandwich)');
  });

  it('covariances, residual variances, R² and factor correlations are built from the result', () => {
    const c = ctxOf('cb-service-quality-ml', 'unstandardized');
    const cov = cbCovariancesTable(c);
    expect(cov.rows.map((r) => r.label)).toContain(
      'SQ (variance)'.replace('SQ', cbFixture('cb-service-quality-ml').model.constructs[0]!.name),
    );
    const res = cbResidualsTable(c);
    expect(res.rows.length).toBeGreaterThan(13);
    expect(res.rows.some((r) => r.label!.endsWith('(disturbance)'))).toBe(true);
    const r2 = cbR2Table(c);
    expect(r2.rows).toHaveLength(2);
    const corr = cbCorrelationsTable(c)!;
    expect(corr.rows).toHaveLength(3);
    expect(corr.rows[1]![corr.columns[1]!.key]).toMatch(/^0\.\d{3}$/);
  });

  it('keeps a Heywood residual variance negative (never clamped) and diagnoses it neutrally', () => {
    const c = ctxOf('cb-heywood', 'unstandardized');
    const res = cbResidualsTable(c);
    expect(res.rows.some((r) => r.est!.startsWith('−'))).toBe(true);
    const d = cbDiagnostics(c.result);
    expect(d.admissible).toBe(false);
    expect(d.heywood.join(' ')).toMatch(/Heywood/);
    expect(d.others.map((o) => o.code)).toContain('CB_JUST_IDENTIFIED');
    expect(toHtml(res, { includeCaption: true, includeNotes: true })).toContain('<table');
  });

  it('the legend differs between the scales', () => {
    expect(scaleLegend('standardized')).toMatch(/std\.all/);
    expect(scaleLegend('unstandardized')).toMatch(/identification scaling/);
    expect(scaleLegend('standardized')).not.toBe(scaleLegend('unstandardized'));
  });
});
