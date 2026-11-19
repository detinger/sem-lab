/**
 * Dragging a data column from the indicator palette onto a construct adds that column as a new
 * indicator in the construct's block. The palette (drag source) and the construct node (drop
 * target) share the MIME type and the single `addColumnToConstruct` edit defined here.
 */
import * as ops from '@/domain/model-ops';
import { useModeler } from './store';

/** Custom drag payload: one or more dataset column names, newline-separated. */
export const COLUMN_MIME = 'application/x-sem-column';

/** Serialise / parse the dragged column list carried in the dataTransfer payload. */
export const encodeColumns = (columns: string[]): string => columns.join('\n');
export const decodeColumns = (payload: string): string[] =>
  payload
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean);

/**
 * Add each column in `columns` as a new indicator assigned to `constructId`, as ONE undoable step,
 * stacking the new nodes just left of the construct (mirroring the inspector's "Add indicator").
 * Columns already present as indicators are skipped. No-op if the construct is gone or nothing is
 * left to add.
 */
export function addColumnsToConstruct(constructId: string, columns: string[]): void {
  const st = useModeler.getState();
  if (!ops.isConstruct(st.model, constructId)) return;
  const taken = new Set(st.model.indicators.map((i) => i.column).filter(Boolean));
  const toAdd = [...new Set(columns)].filter((c) => c && !taken.has(c));
  if (toAdd.length === 0) return;
  let newIds: string[] = [];
  st.edit(
    (m) => {
      const r = ops.addIndicators(
        m,
        constructId,
        toAdd.map((column) => ({ name: column, column })),
      );
      newIds = r.ids;
      return r.model;
    },
    (l, m) => {
      const base = l.nodes[constructId];
      if (!base || newIds.length === 0) return l;
      const after = ops.constructById(m, constructId)?.indicatorIds.length ?? newIds.length;
      const before = after - newIds.length;
      const nodes = { ...l.nodes };
      newIds.forEach((id, k) => {
        nodes[id] = { x: base.x - 140, y: base.y - 40 + (before + k) * 48 };
      });
      return { ...l, nodes };
    },
  );
}
