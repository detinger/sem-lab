import { useId, type InputHTMLAttributes } from 'react';

import { cx } from './cx';
import './Checkbox.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  hint?: string;
}

export function Checkbox({ label, hint, className, id, ...rest }: CheckboxProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  return (
    <div className={cx('ui-check', className)}>
      <input
        id={inputId}
        type="checkbox"
        className="ui-check__box"
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      />
      <label htmlFor={inputId} className="ui-check__label">
        {label}
        {hint ? (
          <span id={hintId} className="ui-check__hint">
            {hint}
          </span>
        ) : null}
      </label>
    </div>
  );
}

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  hint?: string;
}

export function Switch({ label, hint, className, id, ...rest }: SwitchProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  return (
    <div className={cx('ui-check', className)}>
      <input
        id={inputId}
        type="checkbox"
        role="switch"
        className="ui-switch"
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      />
      <label htmlFor={inputId} className="ui-check__label">
        {label}
        {hint ? (
          <span id={hintId} className="ui-check__hint">
            {hint}
          </span>
        ) : null}
      </label>
    </div>
  );
}
