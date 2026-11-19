import { X } from 'lucide-react';
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cx } from './cx';
import { IconButton } from './IconButton';
import './Dialog.css';

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Footer actions, aligned right. */
  footer?: ReactNode;
  /** Maximum width in px; default 560. */
  width?: number;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 560,
  className,
}: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const panel = useRef<HTMLDivElement>(null);

  // Move focus in on open and return it to the previously focused element (the trigger) on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], ' + FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="ui-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* The key handler implements the dialog focus trap and Escape. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx('ui-dialog', className)}
        style={{ width: `min(${width}px, 100%)` }}
        onKeyDown={onKeyDown}
      >
        <div className="ui-dialog__header">
          <h2 id={titleId} className="ui-dialog__title">
            {title}
          </h2>
          <IconButton aria-label="Close dialog" size="small" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="ui-dialog__body">
          {description ? (
            <p id={descId} className="ui-dialog__description">
              {description}
            </p>
          ) : null}
          {children}
        </div>
        {footer ? <div className="ui-dialog__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
