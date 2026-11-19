import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Info,
  Lightbulb,
  TriangleAlert,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { cx } from './cx';
import './ValidationRow.css';

export type Severity = 'error' | 'warning' | 'recommendation' | 'info' | 'success';

const ICONS = {
  error: CircleAlert,
  warning: TriangleAlert,
  recommendation: Lightbulb,
  info: Info,
  success: CircleCheck,
} as const;

const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'Error',
  warning: 'Warning',
  recommendation: 'Recommendation',
  info: 'Information',
  success: 'Passed',
};

export interface ValidationRowProps {
  severity: Severity;
  title: string;
  /** Explanation: the problem, its consequence and a possible fix. Makes the row expandable. */
  children?: ReactNode;
  defaultOpen?: boolean;
}

export function ValidationRow({
  severity,
  title,
  children,
  defaultOpen = false,
}: ValidationRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const Icon = ICONS[severity];
  const head = (
    <>
      <Icon className="ui-vrow__icon" size={16} aria-hidden="true" />
      <span className="ui-vrow__title">
        <span className="sr-only">{SEVERITY_LABEL[severity]}: </span>
        {title}
      </span>
    </>
  );

  return (
    <div className={cx('ui-vrow', `ui-vrow--${severity}`)}>
      {children ? (
        <>
          <button
            type="button"
            className="ui-vrow__head ui-vrow__head--button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((v) => !v)}
          >
            {head}
            <ChevronRight className="ui-vrow__chevron" size={14} aria-hidden="true" />
          </button>
          <div id={bodyId} className="ui-vrow__body" hidden={!open}>
            {children}
          </div>
        </>
      ) : (
        <div className="ui-vrow__head">{head}</div>
      )}
    </div>
  );
}
