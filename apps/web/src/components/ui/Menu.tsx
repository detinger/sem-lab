import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Button, type ButtonVariant } from './Button';
import { cx } from './cx';
import { Kbd } from './Kbd';
import './Menu.css';

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Keyboard shortcut hint, e.g. "Ctrl+Z". Informational only. */
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  /** Visible label of the trigger button. */
  label: string;
  items: readonly MenuItem[];
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: 'default' | 'small';
  align?: 'start' | 'end';
}

/** Button-triggered action menu: ArrowUp/Down, Home/End, Escape (returns focus), Tab closes. */
export function Menu({
  label,
  items,
  icon,
  variant = 'default',
  size,
  align = 'start',
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const enabledItems = () =>
    Array.from(
      list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [],
    );

  // Focus the first item when opened.
  useEffect(() => {
    if (open) enabledItems()[0]?.focus();
  }, [open]);

  // Close on outside pointer.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  function onTriggerKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onListKeyDown(event: KeyboardEvent) {
    const nodes = enabledItems();
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        nodes[(index + 1) % nodes.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        nodes[(index - 1 + nodes.length) % nodes.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        nodes[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        nodes[nodes.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
      default:
    }
  }

  return (
    <div ref={root} className="ui-menu">
      <Button
        ref={trigger}
        variant={open ? 'selected' : variant}
        size={size}
        icon={icon}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {label}
        <ChevronDown size={14} aria-hidden="true" />
      </Button>
      {open ? (
        // Focus lives on the items (roving); the container only handles bubbled arrow keys.
        // eslint-disable-next-line jsx-a11y/interactive-supports-focus
        <div
          ref={list}
          id={menuId}
          role="menu"
          aria-label={label}
          className={cx('ui-menu__list', align === 'end' && 'ui-menu__list--end')}
          onKeyDown={onListKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              className={cx('ui-menu__item', item.danger && 'ui-menu__item--danger')}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              <span className="ui-menu__icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="ui-menu__label">{item.label}</span>
              {item.shortcut ? <Kbd className="ui-menu__kbd">{item.shortcut}</Kbd> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
