import { useMemo, useState } from 'react';
import { Field, Input, Select } from '@/components/ui';
import { DemoFrame, type DemoInitial, Readout, SliderField, fmt, initNum } from './controls';
import { type BootstrapStatistic, bootstrap, histogram } from './math';

const W = 460;
const H = 170;
const M = { t: 14, r: 12, b: 30, l: 12 };

/** Initial keys: `statistic` ("mean" | "correlation"), `B` (100–5000), `seed` (0–2147483647). */
export function BootstrapDemo({ initial = {} }: { initial?: DemoInitial }) {
  const [stat, setStat] = useState<BootstrapStatistic>(
    initial.statistic === 'correlation' ? 'correlation' : 'mean',
  );
  const [B, setB] = useState(Math.round(initNum(initial, 'draws', 1000, 100, 5000)));
  const [seedText, setSeedText] = useState(
    String(Math.round(initNum(initial, 'seed', 123, 0, 2147483647))),
  );
  const seed = /^\d+$/.test(seedText) ? Number(seedText) : NaN;
  const seedOk = Number.isInteger(seed) && seed <= 2147483647;
  const run = useMemo(() => (seedOk ? bootstrap(stat, B, seed) : null), [stat, B, seed, seedOk]);
  const bins = useMemo(() => (run ? histogram(run.draws, 24) : []), [run]);
  const lo = bins[0]?.x0 ?? 0;
  const hi = bins[bins.length - 1]?.x1 ?? 1;
  const x = (v: number) => M.l + ((v - lo) / (hi - lo || 1)) * (W - M.l - M.r);
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const y = (c: number) => H - M.b - (c / maxCount) * (H - M.t - M.b);
  return (
    <DemoFrame
      title="Bootstrap: resampling one small sample"
      formula="SE = sd of the B bootstrap statistics (divisor B − 1) · 95% CI = 2.5th and 97.5th percentile (type 7)"
      guideline={
        <>
          Each draw resamples the 25 observations with replacement using R’s Mersenne-Twister, so
          the same seed always gives the same draws. More draws make the SE and the interval
          steadier; they do not add information about the population. Several thousand draws are
          customary for a final report (a heuristic).
        </>
      }
    >
      <div className="demo__controls">
        <Field label="Statistic">
          {(p) => (
            <Select
              {...p}
              value={stat}
              onChange={(e) => setStat(e.target.value === 'correlation' ? 'correlation' : 'mean')}
            >
              <option value="mean">Mean of x</option>
              <option value="correlation">Correlation of x and y</option>
            </Select>
          )}
        </Field>
        <SliderField
          label="Bootstrap samples B"
          value={B}
          min={100}
          max={5000}
          step={100}
          digits={0}
          onChange={setB}
        />
        <Field
          label="Seed"
          hint="A whole number from 0 to 2,147,483,647."
          {...(seedOk ? {} : { error: 'Enter a whole number from 0 to 2,147,483,647.' })}
        >
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="demo__readouts">
        {run ? (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              className="demo__chart"
              aria-label={`Histogram of ${run.draws.length} bootstrap statistics from ${fmt(lo, 2)} to ${fmt(hi, 2)}. Estimate ${fmt(run.estimate, 3)}, 95% interval ${fmt(run.ci[0], 3)} to ${fmt(run.ci[1], 3)}.`}
            >
              {bins.map((b, i) => (
                <rect
                  key={i}
                  x={x(b.x0) + 0.5}
                  y={y(b.count)}
                  width={Math.max(x(b.x1) - x(b.x0) - 1, 1)}
                  height={H - M.b - y(b.count)}
                  className="demo__bar"
                />
              ))}
              <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} className="demo__axis" />
              <line
                x1={x(run.ci[0])}
                x2={x(run.ci[0])}
                y1={M.t}
                y2={H - M.b}
                className="demo__ci"
              />
              <line
                x1={x(run.ci[1])}
                x2={x(run.ci[1])}
                y1={M.t}
                y2={H - M.b}
                className="demo__ci"
              />
              <line
                x1={x(run.estimate)}
                x2={x(run.estimate)}
                y1={M.t}
                y2={H - M.b}
                className="demo__est"
              />
              <text x={M.l} y={H - 10} className="demo__tick">
                {fmt(lo, 2)}
              </text>
              <text x={W - M.r} y={H - 10} textAnchor="end" className="demo__tick">
                {fmt(hi, 2)}
              </text>
              <text x={x(run.estimate)} y={M.t - 3} textAnchor="middle" className="demo__tick">
                sample estimate
              </text>
            </svg>
            <Readout label="Sample estimate" value={fmt(run.estimate, 3)} />
            <Readout
              label="Bootstrap SE"
              value={fmt(run.se, 3)}
              note={`sd of ${run.draws.length} draws, divisor B − 1`}
            />
            <Readout
              label="95% percentile CI"
              value={`[${fmt(run.ci[0], 3)}, ${fmt(run.ci[1], 3)}]`}
              strong
            />
            {run.dropped > 0 ? (
              <p className="demo__muted">{run.dropped} draws had no variation and were left out.</p>
            ) : null}
          </>
        ) : (
          <p className="demo__muted">Enter a valid seed to resample.</p>
        )}
      </div>
    </DemoFrame>
  );
}
