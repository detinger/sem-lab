import type { ReactNode } from 'react';

import { cx } from './cx';
import './EmptyState.css';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  /** Heading level; pages use 2 under the page's h1. */
  level?: 2 | 3 | 4;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  level = 2,
  children,
  action,
  className,
}: EmptyStateProps) {
  const Heading = `h${level}` as const;
  return (
    <div className={cx('ui-empty', className)}>
      {icon ? (
        <span className="ui-empty__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <Heading className="ui-empty__title">{title}</Heading>
      {children ? <div className="ui-empty__body">{children}</div> : null}
      {action ? <div className="ui-empty__action">{action}</div> : null}
    </div>
  );
}
