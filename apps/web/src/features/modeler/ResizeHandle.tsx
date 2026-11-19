import { useRef } from 'react';

/**
 * A thin vertical divider on a pane's inner edge. Dragging it (or using arrow keys) reports the
 * horizontal movement in pixels; the parent decides how that changes its pane width, so the same
 * handle serves the left palette and the right inspector.
 */
export function ResizeHandle({
  side,
  ariaLabel,
  onResize,
}: {
  side: 'left' | 'right';
  ariaLabel: string;
  onResize: (deltaX: number) => void;
}) {
  const last = useRef<number | null>(null);
  return (
    <button
      type="button"
      className="modeler-resize"
      data-side={side}
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        last.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const dx = e.clientX - last.current;
        last.current = e.clientX;
        if (dx !== 0) onResize(dx);
      }}
      onPointerUp={(e) => {
        last.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        last.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onResize(-16);
        else if (e.key === 'ArrowRight') onResize(16);
        else return;
        e.preventDefault();
      }}
    />
  );
}
