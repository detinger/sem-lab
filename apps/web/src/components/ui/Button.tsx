import type { ComponentProps, ReactNode } from 'react';

import { cx } from './cx';
import './Button.css';

export type ButtonVariant =
  'default' | 'primary' | 'secondary' | 'ghost' | 'danger' | 'selected' | 'accent';
export type ControlSize = 'default' | 'small';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ControlSize;
  /** Optional leading icon element, e.g. `<Plus />`. Decorative; the label names the button. */
  icon?: ReactNode;
}

export function Button({
  variant = 'default',
  size = 'default',
  icon,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('ui-btn', `ui-btn--${variant}`, size === 'small' && 'ui-btn--sm', className)}
      {...rest}
    >
      {icon ? (
        <span className="ui-btn__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
