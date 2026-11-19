import { useId, type ReactNode } from 'react';

import { cx } from './cx';
import './Input.css';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  /** Render the control with the wiring props spread onto it: `{(p) => <Input {...p} />}`. */
  children: (control: FieldControlProps) => ReactNode;
}

/** Label, control, hint and error with htmlFor / aria-describedby wiring (STYLE.md section 6). */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const base = useId();
  const id = `${base}-control`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className={cx('ui-field', className)}>
      <label className="ui-field__label" htmlFor={id}>
        {label}
        {required ? (
          <span className="ui-field__required" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
        required: required || undefined,
      })}
      {hint ? (
        <span id={hintId} className="ui-field__hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="ui-field__error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
