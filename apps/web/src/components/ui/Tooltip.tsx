import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';

import { cx } from './cx';
import './Tooltip.css';

export type TooltipPlacement = 'top' | 'bottom' | 'right';

export interface TooltipProps {
  content: string;
  /** A single focusable element; it receives `aria-describedby`. */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  placement?: TooltipPlacement;
  /** Hover delay in milliseconds. Keyboard focus shows the tip immediately. */
  delay?: number;
  disabled?: boolean;
}

interface Anchor {
  x: number;
  y: number;
}

export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 400,
  disabled = false,
}: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function show() {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (placement === 'right') {
      setAnchor({ x: rect.right, y: rect.top + rect.height / 2 });
    } else {
      setAnchor({
        x: rect.left + rect.width / 2,
        y: placement === 'top' ? rect.top : rect.bottom,
      });
    }
  }

  function hide() {
    window.clearTimeout(timer.current);
    setAnchor(null);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') hide();
  }

  const describedBy = [children.props['aria-describedby'], id].filter(Boolean).join(' ');

  if (disabled) return children;

  return (
    // The wrapper only listens for bubbled pointer/focus events; it is not itself interactive.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <span
      ref={anchorRef}
      className="ui-tooltip-anchor"
      onMouseEnter={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(show, delay);
      }}
      onMouseLeave={hide}
      onFocus={() => {
        window.clearTimeout(timer.current);
        show();
      }}
      onBlur={hide}
      onKeyDown={onKeyDown}
    >
      {cloneElement(children, { 'aria-describedby': describedBy })}
      <span
        role="tooltip"
        id={id}
        className={cx('ui-tooltip', `ui-tooltip--${placement}`)}
        data-visible={anchor ? 'true' : 'false'}
        style={anchor ? { left: anchor.x, top: anchor.y } : undefined}
      >
        {content}
      </span>
    </span>
  );
}
