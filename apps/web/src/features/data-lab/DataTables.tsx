import { useState } from 'react';
import {
  Badge,
  Card,
  CardHeader,
  SegmentedControl,
  Table,
  TableCaption,
  Td,
  Th,
  Tooltip,
} from '@/components/ui';
import { cellValue } from '@/domain/dataset/transform';
import type { ColumnProfile } from '@/domain/dataset/types';
import { EN_DASH, fmt, pct, truncate } from './format';
import { useDataLab } from './store';

export const PREVIEW_ROWS = 50;

function KindBadge({ kind }: { kind: ColumnProfile['kind'] }) {
  if (kind === 'text') return <Badge variant="warning">text</Badge>;
  if (kind === 'empty') return <Badge>empty</Badge>;
  return <Badge variant="info">numeric</Badge>;
}

export function PreviewTable() {
  const dataset = useDataLab((s) => s.dataset);
  if (!dataset) return null;
  const shown = Math.min(PREVIEW_ROWS, dataset.rowIndex.length);
  return (
    <Card className="dl-card" aria-labelledby="dl-preview-h">
      <CardHeader level={2} title={<span id="dl-preview-h">Preview</span>} />
      <p className="dl-muted">
        First {shown} of {dataset.rowIndex.length.toLocaleString('en-US')} rows of the working
        table. # is the row number in the original file. A dash means missing.
      </p>
      <Table aria-label="Preview of the working table" wrapperClassName="dl-scroll">
        <TableCaption>
          Text columns are marked “text”; they cannot be used as indicators.
        </TableCaption>
        <thead>
          <tr>
            <Th numeric scope="col">
              #
            </Th>
            {dataset.columns.map((c) => (
              <Th key={c.name} scope="col" numeric={c.kind === 'numeric'}>
                {c.name}
                {c.kind !== 'numeric' ? (
                  <span className="dl-kind-mark">{c.kind === 'text' ? 'text' : 'empty'}</span>
                ) : null}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: shown }, (_, i) => (
            <tr key={i}>
              <Td numeric className="dl-rownum">
                {(dataset.rowIndex[i] as number) + 1}
              </Td>
              {dataset.columns.map((c) => {
                const v = cellValue(c, i);
                return v === null ? (
                  <Td key={c.name} numeric={c.kind === 'numeric'} className="dl-missing">
                    <span aria-label="missing value" role="img">
                      {EN_DASH}
                    </span>
                  </Td>
                ) : (
                  <Td
                    key={c.name}
                    numeric={c.kind === 'numeric'}
                    className={c.kind === 'text' ? 'dl-text-cell' : undefined}
                  >
                    {typeof v === 'number' ? fmt(v, 3) : v}
                  </Td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

/** Tiny distribution: value counts or histogram bars in --chart-1, inline SVG. */
export function Sparkline({ profile }: { profile: ColumnProfile }) {
  const bars: number[] = profile.valueCounts
    ? profile.valueCounts.map((v) => v.count)
    : profile.histogram
      ? profile.histogram.map((b) => b.count)
      : [];
  if (profile.kind !== 'numeric' || bars.length === 0)
    return <span className="dl-muted">{EN_DASH}</span>;
  const w = 72;
  const h = 22;
  const gap = 1;
  const bw = Math.max(1, (w - gap * (bars.length - 1)) / bars.length);
  const max = Math.max(...bars);
  const label = profile.valueCounts
    ? `Distribution of ${profile.name}: counts for ${bars.length} distinct values`
    : `Distribution of ${profile.name}: histogram with ${bars.length} bins`;
  return (
    <svg
      className="dl-spark"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
    >
      <line x1="0" x2={w} y1={h - 0.5} y2={h - 0.5} stroke="var(--chart-axis)" strokeWidth="1" />
      {bars.map((c, i) => {
        const bh = Math.max(c > 0 ? 1 : 0, (c / max) * (h - 2));
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={h - 1 - bh}
            width={bw}
            height={bh}
            rx="1"
            fill="var(--chart-1)"
          />
        );
      })}
    </svg>
  );
}

export function ProfileTable() {
  const dataset = useDataLab((s) => s.dataset);
  const profiles = useDataLab((s) => s.profiles);
  const [sd, setSd] = useState<'sample' | 'population'>('sample');
  if (!dataset) return null;
  const rows = dataset.rowIndex.length;
  return (
    <Card className="dl-card" aria-labelledby="dl-profile-h">
      <CardHeader
        level={2}
        title={<span id="dl-profile-h">Column profiles</span>}
        action={
          <SegmentedControl
            aria-label="Standard deviation"
            size="small"
            value={sd}
            onChange={setSd}
            options={[
              { value: 'sample', label: 'Sample SD' },
              { value: 'population', label: 'Population SD' },
            ]}
          />
        }
      />
      <p className="dl-muted">
        Statistics use the non-missing values of each column. Skewness is the adjusted G1 and
        kurtosis the adjusted excess G2.
      </p>
      <Table aria-label="Column profiles" wrapperClassName="dl-scroll">
        <thead>
          <tr>
            <Th scope="col">Column</Th>
            <Th scope="col">Type</Th>
            <Th numeric scope="col">
              n
            </Th>
            <Th numeric scope="col">
              Missing
            </Th>
            <Th numeric scope="col">
              Unique
            </Th>
            <Th numeric scope="col">
              Min
            </Th>
            <Th numeric scope="col">
              Max
            </Th>
            <Th numeric scope="col">
              Mean
            </Th>
            <Th numeric scope="col">
              <Tooltip
                content="Sample SD divides by n − 1; population SD divides by n. SmartPLS reports the population SD."
                placement="bottom"
              >
                <button type="button" className="dl-th-help">
                  {sd === 'sample' ? 'SD (sample)' : 'SD (population)'}
                </button>
              </Tooltip>
            </Th>
            <Th numeric scope="col">
              Skew
            </Th>
            <Th numeric scope="col">
              Ex. kurt
            </Th>
            <Th scope="col">Distribution</Th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.name}>
              <Td className="dl-colname">
                <span className="dl-colname__text">{p.name}</span>
                {p.nonNumericCount ? (
                  <span className="dl-nonnumeric">
                    {p.nonNumericCount} non-numeric {p.nonNumericCount === 1 ? 'value' : 'values'}
                    {p.nonNumericExamples && p.nonNumericExamples.length > 0
                      ? `, e.g. ${p.nonNumericExamples.map((e) => `“${truncate(e)}”`).join(', ')}`
                      : ''}
                  </span>
                ) : null}
              </Td>
              <Td>
                <KindBadge kind={p.kind} />
              </Td>
              <Td numeric>{p.n.toLocaleString('en-US')}</Td>
              <Td numeric>
                {p.nMissing.toLocaleString('en-US')} ({pct(p.nMissing, rows)})
              </Td>
              <Td numeric>{p.nUnique.toLocaleString('en-US')}</Td>
              <Td numeric>{fmt(p.min)}</Td>
              <Td numeric>{fmt(p.max)}</Td>
              <Td numeric>{fmt(p.mean)}</Td>
              <Td numeric>{fmt(sd === 'sample' ? p.sdSample : p.sdPopulation)}</Td>
              <Td numeric>{fmt(p.skewness)}</Td>
              <Td numeric>{fmt(p.kurtosis)}</Td>
              <Td>
                <Sparkline profile={p} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
