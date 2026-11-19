import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import { cx } from './cx';
import { rovingTarget } from './roving';
import './SegmentedControl.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  size?: 'default' | 'small';
  className?: string;
}

/** A radio group drawn as joined buttons, for small option sets such as orientation. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'default',
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const group = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = options.findIndex((o) => o.value === value);
    const next = rovingTarget(event.key, index, options.length, true);
    if (next === null) return;
    event.preventDefault();
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }

  return (
    // Focus lives on the radios (roving); the container only handles bubbled arrow keys.
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus
    <div
      ref={group}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx('ui-segmented', size === 'small' && 'ui-segmented--sm', className)}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className="ui-segmented__item"
            onClick={() => onChange(option.value)}
          >
            {option.icon ? (
              <span className="ui-segmented__icon" aria-hidden="true">
                {option.icon}
              </span>
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
