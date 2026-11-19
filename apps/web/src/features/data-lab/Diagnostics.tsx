import { useMemo, useState } from 'react';
import { Card, CardHeader, SegmentedControl } from '@/components/ui';
import { correlations, missingness } from '@/domain/dataset/stats';
import { useModeler } from '@/features/modeler/store';
import { EN_DASH, fmt, pct, plural } from './format';
import { mappedColumns } from './readiness';
import { useDataLab } from './store';

/** Neutral diverging scale: blue for positive, orange for negative, both from --chart-*. */
function heat(r: number | null): string | undefined {
  if (r === null) return undefined;
  const a = Math.round(Math.min(1, Math.abs(r)) * 42);
  return `color-mix(in srgb, var(${r >= 0 ? '--chart-1' : '--chart-2'}) ${a}%, var(--bg-elevated))`;
}

export function CorrelationsSection() {
  const dataset = useDataLab((s) => s.dataset);
  const model = useModeler((s) => s.model);
  const [method, setMethod] = useState<'pairwise' | 'listwise'>('pairwise');
  const cols = useMemo(
    () =>
      dataset
        ? mappedColumns(model, dataset).filter(
            (c) => dataset.columns.find((x) => x.name === c)?.kind === 'numeric',
          )
        : [],
    [dataset, model],
  );
  const matrix = useMemo(
    () => (dataset && cols.length >= 2 ? correlations(dataset, cols, method) : null),
    [dataset, cols, method],
  );
  if (!dataset) return null;
  const ns = matrix ? matrix.n.flat() : [];
  return (
    <Card className="dl-card" aria-labelledby="dl-corr-h">
      <CardHeader
        level={2}
        title={<span id="dl-corr-h">Correlations</span>}
        action={
          <SegmentedControl
            aria-label="Missing-value handling for correlations"
            size="small"
            value={method}
            onChange={setMethod}
            options={[
              { value: 'pairwise', label: 'Pairwise' },
              { value: 'listwise', label: 'Listwise' },
            ]}
          />
        }
      />
      {!matrix ? (
        <p className="dl-muted">
          Correlations are shown for the columns mapped to the model's indicators. Map at least two
          numeric indicators to see them.
        </p>
      ) : (
        <>
          <p className="dl-muted">
            Pearson r for {plural(cols.length, 'mapped column')}.{' '}
            {method === 'listwise'
              ? `Listwise: n = ${matrix.n[0]?.[0] ?? 0} complete rows.`
              : `Pairwise: n per pair ${Math.min(...ns)}–${Math.max(...ns)}.`}{' '}
            A dash means r is undefined (constant column or fewer than 3 pairs).
          </p>
          <div
            className="dl-scroll dl-heat-wrap"
            role="region"
            aria-label="Correlation matrix"
            // scrollable regions must be keyboard-focusable (same as the UI kit Table)
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
          >
            <table className="dl-heat">
              <thead>
                <tr>
                  <td />
                  {matrix.columns.map((c) => (
                    <th key={c} scope="col" title={c}>
                      <span>{c}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.columns.map((rowName, i) => (
                  <tr key={rowName}>
                    <th scope="row">{rowName}</th>
                    {matrix.columns.map((colName, j) => {
                      const r = matrix.values[i]?.[j] ?? null;
                      return (
                        <td
                          key={colName}
                          style={i === j ? undefined : { background: heat(r) }}
                          className={i === j ? 'dl-heat__diag' : undefined}
                          title={`${rowName} × ${colName}: r = ${fmt(r)} (n = ${matrix.n[i]?.[j] ?? 0})`}
                        >
                          {r === null ? (
                            <span aria-label="undefined">{EN_DASH}</span>
                          ) : (
                            r.toFixed(2)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dl-legend" aria-label="Colour scale legend">
            <span>−1</span>
            <span className="dl-legend__bar" aria-hidden="true" />
            <span>+1</span>
            <span className="dl-muted">
              Orange: negative · blue: positive · the number is always shown.
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

export function MissingnessSection() {
  const dataset = useDataLab((s) => s.dataset);
  const model = useModeler((s) => s.model);
  const info = useMemo(() => {
    if (!dataset) return null;
    const mapped = mappedColumns(model, dataset);
    const cols = mapped.length > 0 ? mapped : dataset.columns.map((c) => c.name);
    return { scope: mapped.length > 0 ? 'mapped' : 'all', cols, m: missingness(dataset, cols) };
  }, [dataset, model]);
  if (!dataset || !info) return null;
  const { m, cols } = info;
  const rows = m.rows;
  const top = m.patterns.slice(0, 6);
  return (
    <Card className="dl-card" aria-labelledby="dl-miss-h">
      <CardHeader level={2} title={<span id="dl-miss-h">Missing values</span>} />
      <p className="dl-muted">
        {info.scope === 'mapped'
          ? 'Columns mapped to the model.'
          : 'All columns (nothing is mapped yet).'}{' '}
        {m.completeRows.toLocaleString('en-US')} of {rows.toLocaleString('en-US')} rows are complete
        ({pct(m.completeRows, rows)}).
      </p>
      <ul className="dl-bars" aria-label="Missing values per column">
        {m.byColumn.map((b) => (
          <li key={b.column}>
            <span className="dl-bars__name" title={b.column}>
              {b.column}
            </span>
            <span className="dl-bars__track" aria-hidden="true">
              <span
                className="dl-bars__fill"
                style={{ width: `${rows ? (100 * b.missing) / rows : 0}%` }}
              />
            </span>
            <span className="dl-bars__value">
              {b.missing.toLocaleString('en-US')} ({pct(b.missing, rows)})
            </span>
          </li>
        ))}
      </ul>
      <h3 className="dl-subhead">Most frequent patterns</h3>
      <ul className="dl-patterns" aria-label="Missingness patterns">
        {top.map((p, i) => {
          const missingCols = cols.filter((_, j) => p.missing[j]);
          return (
            <li key={i}>
              <span
                className="dl-pattern"
                role="img"
                aria-label={
                  missingCols.length === 0 ? 'complete' : `missing: ${missingCols.join(', ')}`
                }
              >
                {p.missing.map((x, j) => (
                  <span key={j} data-missing={x ? 'true' : 'false'} />
                ))}
              </span>
              <span className="dl-pattern__text">
                {missingCols.length === 0 ? 'Complete' : `Missing: ${truncList(missingCols)}`}
              </span>
              <span className="dl-pattern__count">
                {p.count.toLocaleString('en-US')} ({pct(p.count, rows)})
              </span>
            </li>
          );
        })}
      </ul>
      <p className="dl-muted">
        Each square is one column in the order of the bars above; filled means missing.
        {m.patterns.length >= 50 ? ' Only the 50 most frequent patterns are counted.' : ''}
      </p>
    </Card>
  );
}

function truncList(items: string[], max = 4): string {
  return items.length <= max
    ? items.join(', ')
    : `${items.slice(0, max).join(', ')} +${items.length - max} more`;
}
