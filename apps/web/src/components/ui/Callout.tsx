import { CircleAlert, CircleCheck, Info, Lightbulb, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { cx } from './cx';
import './Callout.css';

export type CalloutVariant = 'info' | 'recommendation' | 'warning' | 'error' | 'success';

const ICONS = {
  info: Info,
  recommendation: Lightbulb,
  warning: TriangleAlert,
  error: CircleAlert,
  success: CircleCheck,
} as const;

export interface CalloutProps {
  variant?: CalloutVariant;
  title?: string;
  children?: ReactNode;
  className?: string;
}

export function Callout({ variant = 'info', title, children, className }: CalloutProps) {
  const Icon = ICONS[variant];
  return (
    <div role="note" className={cx('ui-callout', `ui-callout--${variant}`, className)}>
      <Icon className="ui-callout__icon" size={18} aria-hidden="true" />
      <div className="ui-callout__body">
        {title ? <p className="ui-callout__title">{title}</p> : null}
        {children ? <div className="ui-callout__text">{children}</div> : null}
      </div>
    </div>
  );
}
