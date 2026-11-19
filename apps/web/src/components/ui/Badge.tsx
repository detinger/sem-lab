import type { HTMLAttributes } from 'react';

import { cx } from './cx';
import './Badge.css';

export type BadgeVariant =
  'neutral' | 'info' | 'success' | 'warning' | 'error' | 'recommendation' | 'accent';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = 'neutral', className, ...rest }: BadgeProps) {
  return <span className={cx('ui-badge', `ui-badge--${variant}`, className)} {...rest} />;
}
