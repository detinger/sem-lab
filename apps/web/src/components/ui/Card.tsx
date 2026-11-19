import type { HTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

import { cx } from './cx';
import './Card.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds the linked-card hover treatment (primary border, medium shadow). */
  interactive?: boolean;
}

export function Card({ interactive, className, ...rest }: CardProps) {
  return <div className={cx('ui-card', interactive && 'ui-card--linked', className)} {...rest} />;
}

/** A whole-card link to an in-app route. */
export function LinkCard({ className, ...rest }: LinkProps) {
  return (
    <Link className={cx('ui-card', 'ui-card--linked', 'ui-card--link', className)} {...rest} />
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  /** Heading level for the title; default 3 (STYLE.md card heading). */
  level?: 2 | 3 | 4;
  /** Utility action aligned to the right of the title. */
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function CardHeader({ title, level = 3, action, icon, className }: CardHeaderProps) {
  const Heading = `h${level}` as const;
  return (
    <div className={cx('ui-card__header', className)}>
      {icon ? (
        <span className="ui-card__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <Heading className="ui-card__title">{title}</Heading>
      {action ? <div className="ui-card__action">{action}</div> : null}
    </div>
  );
}
