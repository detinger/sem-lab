import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

import type { ControlSize } from './Button';
import { cx } from './cx';
import './Input.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: ControlSize;
  invalid?: boolean;
}

export function Input({ size = 'default', invalid, className, ...rest }: InputProps) {
  return (
    <input
      className={cx('ui-control', size === 'small' && 'ui-control--sm', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: ControlSize;
  invalid?: boolean;
}

export function Select({ size = 'default', invalid, className, children, ...rest }: SelectProps) {
  return (
    <span className={cx('ui-select', className)}>
      <select
        className={cx('ui-control', 'ui-select__native', size === 'small' && 'ui-control--sm')}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown className="ui-select__chevron" size={16} aria-hidden="true" />
    </span>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, rows = 3, ...rest }: TextareaProps) {
  return (
    <textarea
      className={cx('ui-control', 'ui-textarea', className)}
      rows={rows}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}
