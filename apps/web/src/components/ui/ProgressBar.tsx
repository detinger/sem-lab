import { useId } from 'react';

import { cx } from './cx';
import './ProgressBar.css';

export interface ProgressBarProps {
  /** Real, measured progress only. STYLE.md forbids fake progress; use Spinner when unknown. */
  value: number;
  max?: number;
  label: string;
  showValue?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  showValue = true,
  className,
}: ProgressBarProps) {
  const labelId = useId();
  const clamped = Math.min(Math.max(value, 0), max);
  const percent = max > 0 ? Math.round((clamped / max) * 100) : 0;
  return (
    <div className={cx('ui-progress', className)}>
      <div className="ui-progress__meta">
        <span id={labelId} className="ui-progress__label">
          {label}
        </span>
        {showValue ? <span className="ui-progress__value">{percent}%</span> : null}
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
        className="ui-progress__track"
      >
        <div className="ui-progress__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
