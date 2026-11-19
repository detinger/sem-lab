import { bin, extent } from 'd3-array';
import { scaleLinear } from 'd3-scale';
import { useMemo, useState } from 'react';
import { Field, Select, Table, Td, Th } from '@/components/ui';
import type { NormalizedSemResult, SemModel } from '@sem-lab/contracts';
import { type NumberStyle, formatNumber } from '../reports/format';

const W = 640;
const H = 260;
const M = { top: 40, right: 16, bottom: 44, left: 52 };

export function parameterLabel(model: SemModel, key: string): string {
  const name = (id: string): string =>
    model.constructs.find((c) => c.id === id)?.name ??
    model.indicators.find((i) => i.id === id)?.name ??
    id;
  const [kind, rest = ''] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const chain = rest.split('->').map(name).join(' → ');
  return kind === 'specific-indirect' ? `Specific indirect: ${chain}` : `Path: ${chain}`;
}

export function BootstrapSection({
  model,
  result,
  style,
}: {
  model: SemModel;
  result: NormalizedSemResult;
  style: Partial<NumberStyle>;
}) {
  const draws = result.bootstrap?.draws;
  const keys = useMemo(() => Object.keys(draws ?? {}), [draws]);
  const [picked, setPicked] = useState<string | null>(null);
  const key = picked && keys.includes(picked) ? picked : (keys[0] ?? null);
  if (!result.bootstrap || !draws || !key)
    return (
      <p className="rs-empty">
        This run has no stored bootstrap draws. Run the analysis with the bootstrap switched on to
        see the distribution of each path.
      </p>
    );
  const values = draws[key] ?? [];
  const param = result.parameters.find((p) => p.key === key);
  const est = param?.est ?? null;
  const lo = param?.ciLower ?? null;
  const hi = param?.ciUpper ?? null;
  const level = Math.round(result.bootstrap.confidenceLevel * 100);

  const [min = 0, max = 1] = extent([...values, ...(est !== null ? [est] : [])]);
  const pad = (max - min) * 0.04 || 0.05;
  const x = scaleLinear()
    .domain([min - pad, max + pad])
    .range([M.left, W - M.right]);
  const bins = bin()
    .domain(x.domain() as [number, number])
    .thresholds(Math.min(30, Math.max(8, Math.round(Math.sqrt(values.length)))))(values);
  const maxCount = Math.max(1, ...bins.map((b) => b.length));
  const y = scaleLinear()
    .domain([0, maxCount])
    .nice()
    .range([H - M.bottom, M.top]);
  const mark = (v: number | null, cls: string, label: string, dy: number) =>
    v === null ? null : (
      <g>
        <line className={cls} x1={x(v)} x2={x(v)} y1={M.top - 4} y2={H - M.bottom} />
        <text className="rs-chart__mark" x={x(v)} y={M.top - 8 + dy} textAnchor="middle">
          {label}
        </text>
      </g>
    );

  return (
    <div className="rs-boot">
      <Field label="Parameter">
        {(p) => (
          <Select {...p} value={key} onChange={(e) => setPicked(e.target.value)}>
            {keys.map((k) => (
              <option key={k} value={k}>
                {parameterLabel(model, k)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <svg
        className="rs-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Histogram of ${values.length} bootstrap estimates of ${parameterLabel(model, key)}. Point estimate ${formatNumber(est, style)}, ${level}% percentile interval ${formatNumber(lo, style)} to ${formatNumber(hi, style)}.`}
      >
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line className="rs-chart__grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
            <text className="rs-chart__tick" x={M.left - 8} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {bins.map((b, i) => (
          <rect
            key={i}
            className="rs-chart__bar"
            x={x(b.x0 ?? 0) + 0.5}
            y={y(b.length)}
            width={Math.max(0, x(b.x1 ?? 0) - x(b.x0 ?? 0) - 1)}
            height={y(0) - y(b.length)}
          />
        ))}
        <line
          className="rs-chart__axis"
          x1={M.left}
          x2={W - M.right}
          y1={H - M.bottom}
          y2={H - M.bottom}
        />
        {x.ticks(6).map((t) => (
          <text
            key={t}
            className="rs-chart__tick"
            x={x(t)}
            y={H - M.bottom + 16}
            textAnchor="middle"
          >
            {formatNumber(t, { decimals: 2, leadingZero: true })}
          </text>
        ))}
        {mark(lo, 'rs-chart__ci', `${level}% CI low`, 0)}
        {mark(hi, 'rs-chart__ci', `${level}% CI high`, 0)}
        {mark(est, 'rs-chart__est', 'Estimate', -10)}
        <text
          className="rs-chart__label"
          x={(M.left + W - M.right) / 2}
          y={H - 6}
          textAnchor="middle"
        >
          Bootstrap estimate (standardized)
        </text>
        <text
          className="rs-chart__label"
          transform={`translate(12 ${(M.top + H - M.bottom) / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          Number of draws
        </text>
      </svg>
      <p className="rs-notes">
        {values.length.toLocaleString('en')} stored draws of{' '}
        {result.bootstrap.completed.toLocaleString('en')} valid ones (rounded to 6 significant
        digits). Solid line: point estimate; dashed lines: {level}% percentile interval from the
        full-precision draws.
      </p>
      <details className="rs-details">
        <summary>Data table of the histogram</summary>
        <Table aria-label="Histogram bins">
          <thead>
            <tr>
              <Th numeric>From</Th>
              <Th numeric>To</Th>
              <Th numeric>Draws</Th>
            </tr>
          </thead>
          <tbody>
            {bins.map((b, i) => (
              <tr key={i}>
                <Td numeric>{formatNumber(b.x0 ?? null, { ...style, decimals: 3 })}</Td>
                <Td numeric>{formatNumber(b.x1 ?? null, { ...style, decimals: 3 })}</Td>
                <Td numeric>{b.length}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </details>
    </div>
  );
}
