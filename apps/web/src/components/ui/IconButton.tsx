import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { type ButtonVariant, type ControlSize } from './Button';
import { cx } from './cx';
import { Tooltip, type TooltipPlacement } from './Tooltip';
import './Button.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: an icon-only control must have an accessible name (STYLE.md section 15). */
  'aria-label': string;
  /** The icon element, e.g. `<Settings />`. */
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ControlSize;
  tooltipPlacement?: TooltipPlacement;
}

export function IconButton({
  variant = 'ghost',
  size = 'default',
  type = 'button',
  tooltipPlacement,
  className,
  children,
  ...rest
}: IconButtonProps) {
  const label = rest['aria-label'];
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error('IconButton requires a non-empty aria-label.');
  }
  return (
    <Tooltip content={label} placement={tooltipPlacement}>
      <button
        type={type}
        className={cx(
          'ui-btn',
          'ui-btn--icon',
          `ui-btn--${variant}`,
          size === 'small' && 'ui-btn--sm',
          className,
        )}
        {...rest}
      >
        <span className="ui-btn__icon" aria-hidden="true">
          {children}
        </span>
      </button>
    </Tooltip>
  );
}
