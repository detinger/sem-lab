import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { type IpmaPoint, type NavKey, keyboardOrder, nextIndex } from './data';
import { shapePath } from './export';
import { formatTick, layoutChart, POINT_R } from './layout';
import { predecessorText } from './text';
import { formatNumber } from '../reports/format';

const NARROW = 520;

export interface IpmaChartProps {
  points: readonly IpmaPoint[];
  colorIndex: ReadonlyMap<string, number>;
  targetName: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  medians: boolean;
  /** content of the hover / focus insight card */
  renderCard: (p: IpmaPoint) => ReactNode;
  /** overrides the measured width (tests) */
  width?: number;
}

export function IpmaChart({
  points,
  colorIndex,
  targetName,
  selectedId,
  onSelect,
  medians,
  renderCard,
  width: fixedWidth,
}: IpmaChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(960);
  const nodes = useRef(new Map<string, SVGGElement>());
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el || fixedWidth !== undefined) return;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setMeasured(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    setMeasured(Math.round(el.getBoundingClientRect().width) || 960);
    return () => ro.disconnect();
  }, [fixedWidth]);

  const width = fixedWidth ?? measured;
  const narrow = width < NARROW;
  const height = narrow ? 380 : Math.max(440, Math.min(620, Math.round(width * 0.58)));
  const L = useMemo(
    () =>
      layoutChart(points, {
        width,
        height,
        margins: narrow
          ? { top: 12, right: 16, bottom: 54, left: 54 }
          : { top: 20, right: 36, bottom: 62, left: 74 },
        showLabels: !narrow,
        maxLabels: 40,
        medians,
        priorityIds: selectedId ? [selectedId] : [],
      }),
    [points, width, height, narrow, medians, selectedId],
  );
  const order = useMemo(() => keyboardOrder(points), [points]);
  const shownId = hover ?? focus;
  const shown = L.dots.find((d) => d.point.id === shownId);

  const onKey = (e: KeyboardEvent, id: string): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(id);
      return;
    }
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const i = order.findIndex((p) => p.id === id);
      const n = order[nextIndex(i, order.length, e.key as NavKey)];
      if (n) nodes.current.get(n.id)?.focus();
    }
  };

  const R = POINT_R + 1;
  const cardLeft = shown
    ? shown.cx > width * 0.55
      ? Math.max(8, shown.cx - 16 - 270)
      : Math.min(width - 278, shown.cx + 18)
    : 0;
  const cardTop = shown ? Math.max(8, Math.min(height - 190, shown.cy - 40)) : 0;
  const sel = L.dots.find((d) => d.point.id === selectedId);

  return (
    <div className="ipma-chart" ref={wrap} data-narrow={narrow || undefined}>
      <svg
        className="ipma-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`Importance-performance map for ${targetName}. ${points.length} points. Use Tab or arrow keys to move between points and Enter to select; the table below has the same data.`}
      >
        {L.yTicks.map((t) => (
          <g key={`y${t}`}>
            <line
              className="ipma-grid"
              x1={L.plot.x}
              x2={L.plot.x + L.plot.w}
              y1={L.y(t)}
              y2={L.y(t)}
            />
            <text className="ipma-tick" x={L.plot.x - 8} y={L.y(t) + 4} textAnchor="end">
              {formatTick(t)}
            </text>
          </g>
        ))}
        {L.xTicks.map((t) => (
          <g key={`x${t}`}>
            <line
              className="ipma-grid"
              y1={L.plot.y}
              y2={L.plot.y + L.plot.h}
              x1={L.x(t)}
              x2={L.x(t)}
            />
            <text className="ipma-tick" x={L.x(t)} y={L.plot.y + L.plot.h + 18} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        <rect className="ipma-frame" x={L.plot.x} y={L.plot.y} width={L.plot.w} height={L.plot.h} />
        {L.zeroY !== null ? (
          <g>
            <line
              className="ipma-zero"
              x1={L.plot.x}
              x2={L.plot.x + L.plot.w}
              y1={L.zeroY}
              y2={L.zeroY}
            />
            <text className="ipma-tick" x={L.plot.x + 6} y={L.zeroY - 5}>
              0 (no total effect)
            </text>
          </g>
        ) : null}
        {medians && L.medians ? (
          <g className="ipma-median" data-testid="ipma-medians">
            <line
              x1={L.x(L.medians.x)}
              x2={L.x(L.medians.x)}
              y1={L.plot.y}
              y2={L.plot.y + L.plot.h}
            />
            <line
              x1={L.plot.x}
              x2={L.plot.x + L.plot.w}
              y1={L.y(L.medians.y)}
              y2={L.y(L.medians.y)}
            />
            <text x={L.plot.x + L.plot.w - 6} y={L.y(L.medians.y) + 15} textAnchor="end">
              Median of displayed {points[0]?.kind === 'indicator' ? 'indicators' : 'constructs'}
            </text>
          </g>
        ) : null}
        <text
          className="ipma-axis-title"
          x={L.plot.x + L.plot.w / 2}
          y={height - 10}
          textAnchor="middle"
        >
          Performance (0–100)
        </text>
        <text
          className="ipma-axis-title"
          transform={`translate(16 ${L.plot.y + L.plot.h / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {narrow ? 'Importance (total effect)' : `Importance (total effect on ${targetName})`}
        </text>

        {L.labels.placed.map((l) =>
          l.leader ? (
            <line
              key={`lead-${l.id}`}
              className="ipma-leader"
              x1={l.leader.x1}
              y1={l.leader.y1}
              x2={l.leader.x2}
              y2={l.leader.y2}
            />
          ) : null,
        )}
        {sel ? (
          <path
            className="ipma-halo"
            d={shapePath(sel.point.predecessor, sel.cx, sel.cy, R + 8)}
            aria-hidden="true"
          />
        ) : null}
        {L.dots.map((d) => {
          const p = d.point;
          const selected = p.id === selectedId;
          return (
            <g
              key={p.id}
              ref={(el) => {
                if (el) nodes.current.set(p.id, el);
                else nodes.current.delete(p.id);
              }}
              className="ipma-pt"
              data-c={(colorIndex.get(p.constructId) ?? 0) % 8}
              data-selected={selected || undefined}
              data-dim={(selectedId !== null && !selected) || undefined}
              data-pt={p.id}
              tabIndex={0}
              role="button"
              aria-pressed={selected}
              aria-label={`${p.label}: importance ${formatNumber(p.importance, { decimals: 3 })}, performance ${formatNumber(p.performance, { decimals: 1 })} of 100, ${predecessorText(p.predecessor).toLowerCase()}`}
              onClick={() => onSelect(p.id)}
              onKeyDown={(e) => onKey(e, p.id)}
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setFocus(p.id)}
              onBlur={() => setFocus((f) => (f === p.id ? null : f))}
            >
              <circle className="ipma-hit" cx={d.cx} cy={d.cy} r={14} />
              <path className="ipma-mark" d={shapePath(p.predecessor, d.cx, d.cy, R)} />
              {selected ? (
                <path
                  className="ipma-sel"
                  d={shapePath(p.predecessor, d.cx, d.cy, R + 2.5)}
                  aria-hidden="true"
                />
              ) : null}
            </g>
          );
        })}
        {L.labels.placed.map((l) => {
          const p = points.find((q) => q.id === l.id)!;
          return (
            <text
              key={`lab-${l.id}`}
              className="ipma-label"
              data-dim={(selectedId !== null && l.id !== selectedId) || undefined}
              x={l.tx}
              y={l.ty}
              textAnchor={l.anchor}
            >
              {p.label}
            </text>
          );
        })}
      </svg>
      {shown ? (
        <div
          className="ipma-card"
          role="tooltip"
          style={{ left: cardLeft, top: cardTop }}
          data-testid="ipma-insight"
        >
          {renderCard(shown.point)}
        </div>
      ) : null}
      <p className="ipma-chart-note" data-testid="ipma-label-note">
        {narrow
          ? 'Labels are hidden on narrow screens; select a point or see the table.'
          : L.labels.hidden.length > 0
            ? `${L.labels.hidden.length} label${L.labels.hidden.length === 1 ? '' : 's'} hidden; see table`
            : null}
      </p>
    </div>
  );
}
