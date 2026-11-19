import { useId, type ReactNode } from 'react';

export type DemoInitial = Readonly<Record<string, number | string | boolean | number[]>>;

/** Numeric initial value for `key`, clamped to [min, max]; the fallback when absent or invalid. */
export function initNum(
  initial: DemoInitial,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const v = initial[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback;
}

export function initBool(initial: DemoInitial, key: string, fallback: boolean): boolean {
  const v = initial[key];
  return typeof v === 'boolean' ? v : fallback;
}

export function initList(
  initial: DemoInitial,
  key: string,
  fallback: number[],
  min: number,
  max: number,
): number[] {
  const v = initial[key];
  return Array.isArray(v) && v.length > 0 && v.every((x) => Number.isFinite(x))
    ? v.map((x) => Math.min(Math.max(x, min), max))
    : fallback;
}

export const fmt = (v: number | null, digits = 2): string =>
  v === null || !Number.isFinite(v) ? '—' : v.toFixed(digits).replace('-0.00', '0.00');

/** A labelled range input with a live value; the value is also announced as aria-valuetext. */
export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  digits = 2,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  digits?: number;
}) {
  const id = useId();
  const text = fmt(value, digits);
  return (
    <div className="demo-slider">
      <div className="demo-slider__label">
        <span id={`${id}-label`}>{label}</span>
        <output htmlFor={id}>{text}</output>
      </div>
      <input
        id={id}
        aria-labelledby={`${id}-label`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Readout({
  label,
  value,
  note,
  strong,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className={strong ? 'demo-readout demo-readout--strong' : 'demo-readout'}>
      <span className="demo-readout__label">{label}</span>
      <span className="demo-readout__value">{value}</span>
      {note ? <span className="demo-readout__note">{note}</span> : null}
    </div>
  );
}

/** Frame shared by all demos: title, controls + readouts, and a guideline that says what is a heuristic. */
export function DemoFrame({
  title,
  formula,
  children,
  guideline,
}: {
  title: string;
  formula?: string;
  children: ReactNode;
  guideline: ReactNode;
}) {
  return (
    <section className="demo" aria-label={`Interactive demo: ${title}`}>
      <h4 className="demo__title">{title}</h4>
      {formula ? <p className="demo__formula">{formula}</p> : null}
      <div className="demo__body">{children}</div>
      <p className="demo__guideline">{guideline}</p>
    </section>
  );
}

/** Status shown as an icon-free text label so meaning never depends on colour alone. */
export function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={ok ? 'demo-verdict demo-verdict--ok' : 'demo-verdict demo-verdict--no'}>
      <span aria-hidden="true">{ok ? '✓' : '!'}</span> {children}
    </span>
  );
}
