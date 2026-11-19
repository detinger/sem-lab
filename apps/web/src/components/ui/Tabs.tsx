import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { cx } from './cx';
import { rovingTarget } from './roving';
import './Tabs.css';

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  'aria-label': string;
  /** Uncontrolled initial tab; defaults to the first. */
  defaultValue?: string;
  /** Controlled value. */
  value?: string;
  onValueChange?: (id: string) => void;
  /** Denser inspector style: 13px text, `10px 8px` padding. */
  dense?: boolean;
  className?: string;
}

/** WAI-ARIA tabs with automatic activation, roving tabindex and Left/Right/Home/End keys. */
export function Tabs({
  items,
  defaultValue,
  value,
  onValueChange,
  dense,
  className,
  'aria-label': ariaLabel,
}: TabsProps) {
  const base = useId();
  const list = useRef<HTMLDivElement>(null);
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id ?? '');
  const active = value ?? inner;

  function select(id: string) {
    if (value === undefined) setInner(id);
    onValueChange?.(id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((t) => t.id === active);
    const next = rovingTarget(event.key, index, items.length);
    if (next === null) return;
    event.preventDefault();
    const target = items[next];
    if (!target) return;
    select(target.id);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div className={cx('ui-tabs', dense && 'ui-tabs--dense', className)}>
      {/* Focus lives on the tabs (roving); the container only handles bubbled arrow keys. */}
      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
      <div
        ref={list}
        role="tablist"
        aria-label={ariaLabel}
        className="ui-tabs__list"
        onKeyDown={onKeyDown}
      >
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              className="ui-tabs__tab"
              onClick={() => select(item.id)}
            >
              {item.icon ? (
                <span className="ui-tabs__icon" aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${base}-panel-${item.id}`}
          aria-labelledby={`${base}-tab-${item.id}`}
          hidden={item.id !== active}
          tabIndex={0}
          className="ui-tabs__panel"
        >
          {item.id === active ? item.content : null}
        </div>
      ))}
    </div>
  );
}
