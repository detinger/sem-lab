import { cx } from './cx';
import './Spinner.css';

export interface SpinnerProps {
  label?: string;
  size?: number;
  className?: string;
}

/** Indeterminate activity. Not a progress indicator: use ProgressBar for real progress. */
export function Spinner({ label = 'Loading', size = 18, className }: SpinnerProps) {
  return (
    <span role="status" className={cx('ui-spinner', className)}>
      <span className="ui-spinner__ring" style={{ width: size, height: size }} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
