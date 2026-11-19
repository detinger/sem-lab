import { Check } from 'lucide-react';
import { Checkbox, Field, Input, SegmentedControl, Select, Switch } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import {
  BOOTSTRAP_PRESETS,
  CB_SEM_REASON,
  type ConfigState,
  type FieldProblems,
  SIDES_RATIONALE,
  ciGate,
  durationNote,
  methodGate,
  randomSeed,
  weightingGate,
} from './config';

const METHOD_CARDS: Array<{
  id: 'pls-sem' | 'plsc' | 'cb-sem';
  title: string;
  lines: string[];
}> = [
  {
    id: 'pls-sem',
    title: 'PLS-SEM',
    lines: [
      'Composites of indicators; variance-based, estimates every construct as a weighted sum.',
      'Good for prediction-oriented and exploratory models. Reflective blocks are not corrected for measurement error.',
    ],
  },
  {
    id: 'plsc',
    title: 'PLSc',
    lines: [
      'PLS with a consistency correction for reflective (common-factor) constructs.',
      'Loadings and paths approximate a factor model; composite blocks are not corrected.',
    ],
  },
  {
    id: 'cb-sem',
    title: 'CB-SEM',
    lines: [
      'Covariance-based; estimates a common-factor model with global fit tests.',
      'Needs identification and larger samples; reports χ² and fit indices.',
    ],
  },
];

export interface ConfigPanelProps {
  config: ConfigState;
  problems: FieldProblems;
  onChange: (patch: Partial<ConfigState>) => void;
  /** from health.limits.maxBootstrapReps when known */
  maxBootstrap: number | null;
}

export function ConfigPanel({ config, problems, onChange, maxBootstrap }: ConfigPanelProps) {
  const reps = Number(config.repetitions);
  const bca = ciGate('bca');
  return (
    <div className="an-config">
      <section aria-labelledby="an-method">
        <h2 id="an-method" className="an-h2">
          Method
        </h2>
        <div className="an-methods" role="radiogroup" aria-label="Estimation method">
          {METHOD_CARDS.map((m) => {
            const gate = methodGate(m.id);
            const selected = config.method === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={!gate.offered}
                disabled={!gate.offered}
                className={cx('an-method', selected && 'an-method--selected')}
                onClick={() => m.id !== 'cb-sem' && onChange({ method: m.id })}
              >
                <span className="an-method__title">
                  {m.title}
                  {selected ? <Check size={14} aria-hidden="true" /> : null}
                </span>
                {m.lines.map((l) => (
                  <span key={l} className="an-method__line">
                    {l}
                  </span>
                ))}
                {!gate.offered ? (
                  <span className="an-method__reason">
                    {m.id === 'cb-sem' ? CB_SEM_REASON : gate.reason}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="an-note">
          Engine: <strong>r-csem</strong> (R package cSEM). It is fixed for PLS methods.
        </p>
      </section>

      <section aria-labelledby="an-weighting">
        <h2 id="an-weighting" className="an-h2">
          Inner weighting scheme
        </h2>
        <SegmentedControl
          aria-label="Inner weighting scheme"
          value={config.innerWeighting}
          onChange={(innerWeighting) => onChange({ innerWeighting })}
          options={(['path', 'centroid', 'factorial'] as const).map((w) => ({
            value: w,
            label: w[0]!.toUpperCase() + w.slice(1),
          }))}
        />
        {(['path', 'centroid', 'factorial'] as const).map((w) => {
          const g = weightingGate(w);
          return g.offered ? null : (
            <p key={w} className="an-note">
              {w}: {g.reason}
            </p>
          );
        })}
        <details className="an-advanced">
          <summary>Advanced: iterations and tolerance</summary>
          <div className="an-grid2">
            <Field
              label="Maximum iterations"
              {...(problems.maxIterations ? { error: problems.maxIterations } : {})}
            >
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={config.maxIterations}
                  onChange={(e) => onChange({ maxIterations: e.target.value })}
                />
              )}
            </Field>
            <Field label="Tolerance" {...(problems.tolerance ? { error: problems.tolerance } : {})}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={config.tolerance}
                  onChange={(e) => onChange({ tolerance: e.target.value })}
                />
              )}
            </Field>
          </div>
          <p className="an-note">Defaults: 300 iterations and 1e-7, the cSEM defaults.</p>
        </details>
      </section>

      <section aria-labelledby="an-boot">
        <h2 id="an-boot" className="an-h2">
          Bootstrap
        </h2>
        <Switch
          label="Bootstrap for standard errors, t, p and confidence intervals"
          checked={config.bootstrap}
          onChange={(e) => onChange({ bootstrap: e.target.checked })}
        />
        {config.bootstrap ? (
          <>
            <div className="an-presets" role="group" aria-label="Bootstrap presets">
              {BOOTSTRAP_PRESETS.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={cx('an-preset', Number(config.repetitions) === b && 'an-preset--on')}
                  aria-pressed={Number(config.repetitions) === b}
                  onClick={() => onChange({ repetitions: String(b) })}
                >
                  {b.toLocaleString('en')}
                </button>
              ))}
            </div>
            <div className="an-grid2">
              <Field
                label="Bootstrap samples (B)"
                {...(problems.repetitions ? { error: problems.repetitions } : {})}
                hint={
                  maxBootstrap
                    ? `Service limit: ${maxBootstrap.toLocaleString('en')}`
                    : 'Quick: 500; research: 5,000 or more'
                }
              >
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    value={config.repetitions}
                    onChange={(e) => onChange({ repetitions: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label="Seed"
                required
                {...(problems.seed ? { error: problems.seed } : {})}
                hint="Same seed, data and settings reproduce the draws."
              >
                {(p) => (
                  <span className="an-seed">
                    <Input
                      {...p}
                      inputMode="numeric"
                      value={config.seed}
                      onChange={(e) => onChange({ seed: e.target.value })}
                    />
                    <button
                      type="button"
                      className="an-linkbtn"
                      onClick={() => onChange({ seed: String(randomSeed()) })}
                    >
                      New random seed
                    </button>
                  </span>
                )}
              </Field>
            </div>
            {Number.isFinite(reps) && reps > 0 ? (
              <p className="an-note">{durationNote(reps)}</p>
            ) : null}
            <div className="an-grid2">
              <Field
                label="Confidence interval method"
                hint={!bca.offered ? `BCa unavailable: ${bca.reason}` : undefined}
              >
                {(p) => (
                  <Select
                    {...p}
                    value={config.ci}
                    onChange={(e) => onChange({ ci: e.target.value as ConfigState['ci'] })}
                  >
                    <option value="percentile" disabled={!ciGate('percentile').offered}>
                      Percentile
                    </option>
                    <option value="bca" disabled={!bca.offered}>
                      BCa (not available)
                    </option>
                  </Select>
                )}
              </Field>
              <Field label="Confidence level">
                {(p) => (
                  <Select
                    {...p}
                    value={config.confidenceLevel}
                    onChange={(e) =>
                      onChange({
                        confidenceLevel: e.target.value as ConfigState['confidenceLevel'],
                      })
                    }
                  >
                    <option value="0.90">90%</option>
                    <option value="0.95">95%</option>
                    <option value="0.99">99%</option>
                  </Select>
                )}
              </Field>
            </div>
            <Field label="Test direction" hint={SIDES_RATIONALE}>
              {(p) => (
                <Select
                  {...p}
                  value={config.sides}
                  onChange={(e) => onChange({ sides: e.target.value as ConfigState['sides'] })}
                >
                  <option value="two-sided">Two-sided</option>
                  <option value="one-sided">One-sided (direction fixed in advance)</option>
                </Select>
              )}
            </Field>
          </>
        ) : (
          <p className="an-note">
            Without a bootstrap the result has no standard errors, t, p or confidence intervals.
          </p>
        )}
      </section>

      <section aria-labelledby="an-missing">
        <h2 id="an-missing" className="an-h2">
          Missing data
        </h2>
        <Checkbox
          label="Listwise deletion"
          checked
          readOnly
          disabled
          hint="The only handling for PLS methods; nothing is imputed."
        />
      </section>
    </div>
  );
}
