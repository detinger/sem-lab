import { useState } from 'react';
import {
  DemoFrame,
  type DemoInitial,
  Readout,
  SliderField,
  Verdict,
  fmt,
  initBool,
  initList,
  initNum,
} from './controls';
import {
  fSquared,
  fSquaredLabel,
  htmt,
  mediation,
  performance,
  reliabilityFromLoadings,
  rmsea,
  cfi,
  vif,
} from './math';

/**
 * Initial keys: `loadings` (number[], 3–6 values in 0.1–0.99; the length sets k).
 */
export function ReliabilityDemo({ initial = {} }: { initial?: DemoInitial }) {
  const [lambdas, setLambdas] = useState(() => {
    const l = initList(initial, 'loadings', [0.85, 0.8, 0.75, 0.7], 0.1, 0.99).slice(0, 6);
    while (l.length < 3) l.push(0.7);
    return l;
  });
  const r = reliabilityFromLoadings(lambdas);
  const setAt = (i: number, v: number) => setLambdas((l) => l.map((x, j) => (j === i ? v : x)));
  return (
    <DemoFrame
      title="Reliability from standardized loadings"
      formula="r_ij = λ_i·λ_j · α = k·r̄ / (1 + (k − 1)·r̄) · ρC = (Σλ)² / ((Σλ)² + Σ(1 − λ²)) · AVE = Σλ² / k"
      guideline={
        <>
          Common guidelines (heuristics, not tests): α and ρC of .70 or higher, AVE of .50 or higher
          (Hair et al., 2022). Equal loadings make α and ρC agree; unequal loadings pull α below ρC.
        </>
      }
    >
      <div className="demo__controls">
        <div className="demo__row">
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            disabled={lambdas.length <= 3}
            onClick={() => setLambdas((l) => l.slice(0, -1))}
          >
            Remove indicator
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            disabled={lambdas.length >= 6}
            onClick={() => setLambdas((l) => [...l, 0.7])}
          >
            Add indicator
          </button>
          <span className="demo__muted">k = {lambdas.length} indicators</span>
        </div>
        {lambdas.map((l, i) => (
          <SliderField
            key={i}
            label={`Loading λ${i + 1}`}
            value={l}
            min={0.1}
            max={0.99}
            step={0.01}
            onChange={(v) => setAt(i, v)}
          />
        ))}
      </div>
      <div className="demo__readouts">
        <Readout
          label="Mean implied r̄"
          value={fmt(r.meanR, 3)}
          note="average of λiλj over all pairs"
        />
        <Readout
          label="Cronbach’s α (standardized)"
          value={fmt(r.alpha, 3)}
          note={
            <Verdict ok={r.alpha >= 0.7}>
              {r.alpha >= 0.7 ? 'at or above .70' : 'below .70'}
            </Verdict>
          }
        />
        <Readout
          label="Composite reliability ρC"
          value={fmt(r.rhoC, 3)}
          note={
            <Verdict ok={r.rhoC >= 0.7}>{r.rhoC >= 0.7 ? 'at or above .70' : 'below .70'}</Verdict>
          }
        />
        <Readout
          label="AVE"
          value={fmt(r.ave, 3)}
          note={
            <Verdict ok={r.ave >= 0.5}>{r.ave >= 0.5 ? 'at or above .50' : 'below .50'}</Verdict>
          }
        />
      </div>
    </DemoFrame>
  );
}

/** Initial keys: `h` (mean heterotrait correlation), `a`, `b` (mean monotrait correlations). */
export function HtmtDemo({ initial = {} }: { initial?: DemoInitial }) {
  const [h, setH] = useState(initNum(initial, 'heterotrait', 0.55, 0, 0.99));
  const [a, setA] = useState(initNum(initial, 'monotraitA', 0.7, 0.05, 0.99));
  const [b, setB] = useState(initNum(initial, 'monotraitB', 0.65, 0.05, 0.99));
  const v = htmt(h, a, b);
  const status =
    v === null ? '' : v < 0.85 ? 'below .85' : v < 0.9 ? 'between .85 and .90' : 'above .90';
  return (
    <DemoFrame
      title="Heterotrait–monotrait ratio (HTMT)"
      formula="HTMT = h / √(a · b)"
      guideline={
        <>
          Common thresholds (heuristics): .85 for conceptually distinct constructs, .90 for similar
          ones (Henseler et al., 2015). Better still, check whether the bootstrap confidence
          interval includes 1.
        </>
      }
    >
      <div className="demo__controls">
        <SliderField
          label="Mean heterotrait correlation h"
          value={h}
          min={0}
          max={0.99}
          step={0.01}
          onChange={setH}
        />
        <SliderField
          label="Mean monotrait correlation a (construct A)"
          value={a}
          min={0.05}
          max={0.99}
          step={0.01}
          onChange={setA}
        />
        <SliderField
          label="Mean monotrait correlation b (construct B)"
          value={b}
          min={0.05}
          max={0.99}
          step={0.01}
          onChange={setB}
        />
      </div>
      <div className="demo__readouts">
        <Readout
          label="HTMT"
          value={fmt(v, 3)}
          strong
          note={v === null ? null : <Verdict ok={v < 0.85}>{status}</Verdict>}
        />
      </div>
    </DemoFrame>
  );
}

/** Initial keys: `r2` (R² of a predictor on the other predictors). */
export function VifDemo({ initial = {} }: { initial?: DemoInitial }) {
  const [r2, setR2] = useState(initNum(initial, 'r2', 0.6, 0, 0.98));
  const v = vif(r2);
  return (
    <DemoFrame
      title="Variance inflation factor"
      formula="VIF = 1 / (1 − R²)"
      guideline={
        <>
          Rules of thumb (heuristics): in PLS-SEM, values of 3 or lower are ideal, 5 or higher
          signals potential collinearity (Hair et al., 2022). VIF = 5 corresponds to R² = .80.
        </>
      }
    >
      <div className="demo__controls">
        <SliderField
          label="R² of this predictor on the other predictors"
          value={r2}
          min={0}
          max={0.98}
          step={0.01}
          onChange={setR2}
        />
      </div>
      <div className="demo__readouts">
        <Readout
          label="VIF"
          value={fmt(v, 2)}
          strong
          note={
            v === null ? null : (
              <Verdict ok={v < 3}>
                {v < 3 ? 'at or below 3' : v < 5 ? 'between 3 and 5' : '5 or higher'}
              </Verdict>
            )
          }
        />
      </div>
    </DemoFrame>
  );
}

/** Initial keys: `r2in` (R² with the predictor), `r2ex` (R² without it). */
export function F2Demo({ initial = {} }: { initial?: DemoInitial }) {
  const [rin, setRin] = useState(initNum(initial, 'r2Included', 0.5, 0, 0.98));
  const [rex, setRex] = useState(initNum(initial, 'r2Excluded', 0.42, 0, 0.98));
  const v = fSquared(rin, rex);
  const label = v === null ? null : fSquaredLabel(v);
  return (
    <DemoFrame
      title="Effect size f²"
      formula="f² = (R²included − R²excluded) / (1 − R²included)"
      guideline={
        <>
          Cohen’s (1988) conventions: .02 small, .15 medium, .35 large. They are rough heuristics
          for orientation; judge an effect against what is typical in your field.
        </>
      }
    >
      <div className="demo__controls">
        <SliderField
          label="R² with the predictor included"
          value={rin}
          min={0}
          max={0.98}
          step={0.01}
          onChange={setRin}
        />
        <SliderField
          label="R² with the predictor excluded"
          value={rex}
          min={0}
          max={0.98}
          step={0.01}
          onChange={setRex}
        />
      </div>
      <div className="demo__readouts">
        <Readout
          label="f²"
          value={fmt(v, 3)}
          strong
          note={
            label === null ? null : (
              <Verdict ok={label !== 'none'}>
                {label === 'none' ? 'below .02 (negligible)' : label}
              </Verdict>
            )
          }
        />
        {rex > rin ? (
          <p className="demo__muted">
            Excluding a predictor cannot raise R² in the same sample, so f² is negative here.
          </p>
        ) : null}
      </div>
    </DemoFrame>
  );
}

const TYPE_TEXT = {
  complementary:
    'Complementary partial mediation: indirect and direct effects are both significant and point the same way.',
  competitive:
    'Competitive partial mediation: both significant, with opposite signs (the indirect path partly cancels the direct one).',
  'indirect-only':
    'Indirect-only mediation: the indirect effect is significant, the direct effect is not (full mediation).',
  'direct-only':
    'Direct-only: the direct effect is significant, the indirect is not (no mediation).',
  'no-effect':
    'No effect: neither the direct nor the indirect effect is significant (no mediation).',
} as const;

/** Initial keys: `a`, `b`, `cPrime` (−1…1), `indirectSignificant`, `directSignificant` (boolean). */
export function MediationDemo({ initial = {} }: { initial?: DemoInitial }) {
  const [a, setA] = useState(initNum(initial, 'a', 0.5, -1, 1));
  const [b, setB] = useState(initNum(initial, 'b', 0.4, -1, 1));
  const [c, setC] = useState(initNum(initial, 'cPrime', 0.2, -1, 1));
  const [indSig, setIndSig] = useState(initBool(initial, 'indirectSignificant', true));
  const [dirSig, setDirSig] = useState(initBool(initial, 'directSignificant', true));
  const m = mediation(a, b, c, indSig, dirSig);
  return (
    <DemoFrame
      title="Mediation: indirect, direct and total effects"
      formula="indirect = a·b · total = c′ + a·b"
      guideline={
        <>
          The type follows Zhao, Lynch and Chen (2010): it depends on which effects are
          statistically significant (from a bootstrap of the indirect effect) and, when both are, on
          the sign of a·b·c′. Significance is yours to set here; it is not computed from the slider
          values.
        </>
      }
    >
      <div className="demo__controls">
        <SliderField
          label="a: predictor → mediator"
          value={a}
          min={-1}
          max={1}
          step={0.05}
          onChange={setA}
        />
        <SliderField
          label="b: mediator → outcome"
          value={b}
          min={-1}
          max={1}
          step={0.05}
          onChange={setB}
        />
        <SliderField
          label="c′: direct effect, predictor → outcome"
          value={c}
          min={-1}
          max={1}
          step={0.05}
          onChange={setC}
        />
        <label className="demo__check">
          <input type="checkbox" checked={indSig} onChange={(e) => setIndSig(e.target.checked)} />{' '}
          Indirect effect significant
        </label>
        <label className="demo__check">
          <input type="checkbox" checked={dirSig} onChange={(e) => setDirSig(e.target.checked)} />{' '}
          Direct effect significant
        </label>
      </div>
      <div className="demo__readouts">
        <Readout label="Indirect effect a·b" value={fmt(m.indirect, 3)} />
        <Readout label="Total effect c′ + a·b" value={fmt(m.total, 3)} />
        <Readout
          label="Mediation type"
          value={m.type ? m.type.replace('-', ' ') : 'not defined'}
          strong
          note={
            m.type
              ? TYPE_TEXT[m.type]
              : 'Both effects are marked significant but a path is exactly 0, so the sign of a·b·c′ is undefined.'
          }
        />
      </div>
    </DemoFrame>
  );
}

/** Initial keys: `min`, `max` (declared endpoints), `observedMin`, `observedMax`, `mean`. */
export function IpmaRescaleDemo({ initial = {} }: { initial?: DemoInitial }) {
  const [min, setMin] = useState(initNum(initial, 'min', 1, 0, 10));
  const [max, setMax] = useState(initNum(initial, 'max', 7, 2, 11));
  const [omin, setOmin] = useState(initNum(initial, 'observedMin', 2, 0, 11));
  const [omax, setOmax] = useState(initNum(initial, 'observedMax', 6, 0, 11));
  const [m, setM] = useState(initNum(initial, 'mean', 5.2, 0, 11));
  const declared = performance(m, min, max);
  const observed = performance(m, omin, omax);
  const inRange = m >= Math.max(min, omin) && m <= Math.min(max, omax);
  return (
    <DemoFrame
      title="IPMA performance: declared versus observed endpoints"
      formula="performance = (mean − min) / (max − min) × 100"
      guideline={
        <>
          IPMA rescales indicators to 0–100 with the endpoints the instrument <em>allows</em>. Using
          the smallest and largest values respondents happened to give moves the same mean to a
          different performance, and makes constructs that use the scale differently incomparable.
        </>
      }
    >
      <div className="demo__controls">
        <SliderField
          label="Declared minimum (scale anchor)"
          value={min}
          min={0}
          max={10}
          step={1}
          digits={0}
          onChange={setMin}
        />
        <SliderField
          label="Declared maximum (scale anchor)"
          value={max}
          min={2}
          max={11}
          step={1}
          digits={0}
          onChange={setMax}
        />
        <SliderField
          label="Observed minimum"
          value={omin}
          min={0}
          max={11}
          step={1}
          digits={0}
          onChange={setOmin}
        />
        <SliderField
          label="Observed maximum"
          value={omax}
          min={0}
          max={11}
          step={1}
          digits={0}
          onChange={setOmax}
        />
        <SliderField
          label="Indicator mean"
          value={m}
          min={0}
          max={11}
          step={0.1}
          digits={1}
          onChange={setM}
        />
      </div>
      <div className="demo__readouts">
        <Readout
          label="With declared endpoints"
          value={declared === null ? '—' : `${fmt(declared, 1)}`}
          strong
          note="the correct 0–100 performance"
        />
        <Readout
          label="With observed extrema"
          value={observed === null ? '—' : `${fmt(observed, 1)}`}
          note="misleading: depends on who happened to answer"
        />
        {declared !== null && observed !== null ? (
          <p className="demo__muted">Difference: {fmt(observed - declared, 1)} points.</p>
        ) : null}
        {!inRange ? (
          <p className="demo__muted">
            The mean lies outside one of the ranges; performance falls outside 0–100.
          </p>
        ) : null}
        {max <= min ? (
          <p className="demo__muted">The declared maximum must exceed the minimum.</p>
        ) : null}
      </div>
    </DemoFrame>
  );
}

/** Initial keys: `chi2`, `df`, `n`, `chi2Base`, `dfBase`. */
export function RmseaCfiDemo({ initial = {} }: { initial?: DemoInitial }) {
  const [x2, setX2] = useState(initNum(initial, 'chisq', 85, 0, 800));
  const [df, setDf] = useState(initNum(initial, 'df', 40, 1, 200));
  const [n, setN] = useState(initNum(initial, 'n', 300, 20, 2000));
  const [x2b, setX2b] = useState(initNum(initial, 'baselineChisq', 1200, 0, 5000));
  const [dfb, setDfb] = useState(initNum(initial, 'baselineDf', 55, 1, 300));
  const r = rmsea(x2, df, n);
  const c = cfi(x2, df, x2b, dfb);
  return (
    <DemoFrame
      title="RMSEA and CFI"
      formula="RMSEA = √(max(χ²/(N·df) − 1/N, 0)) · CFI = 1 − max(χ² − df, 0) / max(χ² − df, χ²_B − df_B, 0)"
      guideline={
        <>
          These are the formulas of SEM Studio’s CB-SEM engine (lavaan conventions, ML). Popular
          cut-offs (RMSEA ≤ .06, CFI ≥ .95; Hu & Bentler, 1999) are heuristics that depend on model
          and sample; they are not tests. Read fit indices together with the residuals.
        </>
      }
    >
      <div className="demo__controls">
        <SliderField
          label="Model χ²"
          value={x2}
          min={0}
          max={800}
          step={1}
          digits={0}
          onChange={setX2}
        />
        <SliderField
          label="Model df"
          value={df}
          min={1}
          max={200}
          step={1}
          digits={0}
          onChange={setDf}
        />
        <SliderField
          label="Sample size N"
          value={n}
          min={20}
          max={2000}
          step={10}
          digits={0}
          onChange={setN}
        />
        <SliderField
          label="Baseline χ²_B"
          value={x2b}
          min={0}
          max={5000}
          step={10}
          digits={0}
          onChange={setX2b}
        />
        <SliderField
          label="Baseline df_B"
          value={dfb}
          min={1}
          max={300}
          step={1}
          digits={0}
          onChange={setDfb}
        />
      </div>
      <div className="demo__readouts">
        <Readout
          label="RMSEA"
          value={fmt(r, 3)}
          strong
          note={<Verdict ok={r <= 0.06}>{r <= 0.06 ? 'at or below .06' : 'above .06'}</Verdict>}
        />
        <Readout
          label="CFI"
          value={fmt(c, 3)}
          strong
          note={<Verdict ok={c >= 0.95}>{c >= 0.95 ? 'at or above .95' : 'below .95'}</Verdict>}
        />
      </div>
    </DemoFrame>
  );
}
