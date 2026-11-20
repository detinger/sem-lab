/**
 * Modeler state: the open project (scientific model + layout), selection, and history.
 *
 * - Every model edit goes through domain/model-ops; this store only sequences them.
 * - History stores whole {model, layout} snapshots (structural sharing keeps them cheap) and
 *   records ONE entry per user action: a drag is begun with `beginTransaction()` and closed
 *   with `commitTransaction()`, so undo never replays hundreds of intermediate positions
 *   (STYLE §9 "Undo is one transaction per drag").
 * - The store never derives statistics; it is safe to use without any backend.
 */
import {
  DEFAULT_LAYOUT_SETTINGS,
  type DatasetRef,
  type LayoutSettings,
  type SemLayout,
  type SemModel,
  type SemProject,
} from '@sem-lab/contracts';
import { create } from 'zustand';
import * as ops from '@/domain/model-ops';
import { type AlignMode, type Point, align, distribute, snap } from './geometry';
import { computeAutoLayout, mergeLayout, sizeOf } from './layout/auto-layout';

export interface Snapshot {
  model: SemModel;
  layout: SemLayout;
  /** the dataset link travels with history so undo/redo keep model and data link consistent */
  datasetRef?: DatasetRef | undefined;
}

const HISTORY_LIMIT = 200;

export interface ModelerState extends Snapshot {
  projectId: string;
  projectName: string;
  createdAt: string;
  /** fingerprint + column schema of the linked dataset; never row-level data */
  datasetRef: DatasetRef | undefined;
  selection: string[];
  past: Snapshot[];
  future: Snapshot[];
  /** snapshot taken at beginTransaction; null when no transaction is open */
  pending: Snapshot | null;
  /** bumps on every committed change; autosave watches it */
  revision: number;
  /** last user-facing error from an edit (e.g. an invalid connection) */
  lastError: string | null;

  load(project: SemProject): void;
  newProject(name: string): void;
  rename(name: string): void;
  toProject(now: string): SemProject;

  select(ids: string[]): void;
  /** apply a pure model edit as one undoable step; errors become lastError, not exceptions */
  edit(
    fn: (m: SemModel) => SemModel,
    layoutPatch?: (l: SemLayout, m: SemModel) => SemLayout,
  ): boolean;
  setPositions(positions: Record<string, Point>, opts?: { transient?: boolean }): void;
  setLayoutSettings(patch: Partial<LayoutSettings>): void;
  setPinned(ids: string[], pinned: boolean): void;
  /** link (or unlink) the project's dataset; one undoable step, bumps revision (autosave) */
  setDatasetRef(ref: DatasetRef | undefined): void;

  beginTransaction(): void;
  commitTransaction(): void;
  cancelTransaction(): void;
  undo(): void;
  redo(): void;
  clearError(): void;

  /** Insert a copied fragment with fresh ids, offset from the originals, and select it (one undo step). */
  paste(fragment: ops.ModelFragment, positions: Record<string, Point>, offset: Point): void;
  alignSelection(mode: AlignMode): void;
  distributeSelection(axis: 'horizontal' | 'vertical'): void;
  autoArrange(opts?: { keepPinned?: boolean }): Promise<void>;
}

export const emptyLayout = (settings: Partial<LayoutSettings> = {}): SemLayout => ({
  nodes: {},
  settings: { ...DEFAULT_LAYOUT_SETTINGS, ...settings },
});

let idCounter = 0;
const newProjectId = (): string =>
  `proj_${Date.now().toString(36)}_${(idCounter++).toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

const snapshotOf = (s: Snapshot): Snapshot => ({
  model: s.model,
  layout: s.layout,
  datasetRef: s.datasetRef,
});

function pushHistory(s: ModelerState): Pick<ModelerState, 'past' | 'future'> {
  const past = [...s.past, snapshotOf(s)];
  return { past: past.length > HISTORY_LIMIT ? past.slice(-HISTORY_LIMIT) : past, future: [] };
}

/** Drop layout entries for elements that no longer exist (keeps saved projects clean). */
function pruneLayout(layout: SemLayout, model: SemModel): SemLayout {
  const ids = new Set([...model.constructs.map((c) => c.id), ...model.indicators.map((i) => i.id)]);
  for (const a of layout.annotations ?? []) ids.add(a.id);
  const nodes = Object.fromEntries(Object.entries(layout.nodes).filter(([id]) => ids.has(id)));
  const collapsed = layout.settings.collapsedConstructIds.filter((id) => ids.has(id));
  const settings = { ...layout.settings, collapsedConstructIds: collapsed };
  if (layout.settings.observedConstructIds)
    settings.observedConstructIds = layout.settings.observedConstructIds.filter((id) =>
      ids.has(id),
    );
  return { ...layout, nodes, settings };
}

export const useModeler = create<ModelerState>()((set, get) => ({
  projectId: newProjectId(),
  projectName: 'Untitled model',
  createdAt: new Date().toISOString(),
  model: ops.EMPTY_MODEL,
  layout: emptyLayout(),
  datasetRef: undefined,
  selection: [],
  past: [],
  future: [],
  pending: null,
  revision: 0,
  lastError: null,

  load(project) {
    set({
      projectId: project.id,
      projectName: project.name,
      createdAt: project.createdAt,
      model: project.model,
      layout: project.layout,
      datasetRef: project.datasetRef,
      selection: [],
      past: [],
      future: [],
      pending: null,
      lastError: null,
      revision: get().revision + 1,
    });
  },

  newProject(name) {
    set({
      projectId: newProjectId(),
      projectName: name,
      createdAt: new Date().toISOString(),
      model: ops.EMPTY_MODEL,
      layout: emptyLayout(),
      datasetRef: undefined,
      selection: [],
      past: [],
      future: [],
      pending: null,
      lastError: null,
      revision: get().revision + 1,
    });
  },

  rename(name) {
    const trimmed = name.trim();
    if (trimmed) set({ projectName: trimmed, revision: get().revision + 1 });
  },

  toProject(now) {
    const s = get();
    return {
      schemaVersion: 1,
      id: s.projectId,
      name: s.projectName,
      createdAt: s.createdAt,
      updatedAt: now,
      model: s.model,
      layout: s.layout,
      ...(s.datasetRef ? { datasetRef: s.datasetRef } : {}),
    };
  },

  select(ids) {
    set({ selection: [...new Set(ids)] });
  },

  edit(fn, layoutPatch) {
    const s = get();
    let model: SemModel;
    try {
      model = fn(s.model);
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
      return false;
    }
    if (model === s.model && !layoutPatch) return true;
    const layout = pruneLayout(layoutPatch ? layoutPatch(s.layout, model) : s.layout, model);
    const alive = new Set([
      ...model.constructs.map((c) => c.id),
      ...model.indicators.map((i) => i.id),
      ...model.relationships.map((r) => r.id),
    ]);
    set({
      ...(s.pending ? {} : pushHistory(s)),
      model,
      layout,
      selection: s.selection.filter((id) => alive.has(id) || id.startsWith('meas:')),
      lastError: null,
      revision: s.revision + 1,
    });
    return true;
  },

  setPositions(positions, opts) {
    const s = get();
    const nodes = { ...s.layout.nodes };
    for (const [id, p] of Object.entries(positions)) nodes[id] = { ...nodes[id], x: p.x, y: p.y };
    const layout = { ...s.layout, nodes };
    if (opts?.transient || s.pending) set({ layout });
    else set({ ...pushHistory(s), layout, revision: s.revision + 1 });
  },

  setLayoutSettings(patch) {
    const s = get();
    set({
      ...pushHistory(s),
      layout: { ...s.layout, settings: { ...s.layout.settings, ...patch } },
      revision: s.revision + 1,
    });
  },

  setPinned(ids, pinned) {
    const s = get();
    const nodes = { ...s.layout.nodes };
    for (const id of ids) {
      const n = nodes[id];
      if (!n) continue;
      if (pinned) nodes[id] = { ...n, pinned: true };
      else {
        const { pinned: _drop, ...rest } = n;
        nodes[id] = rest;
      }
    }
    set({ ...pushHistory(s), layout: { ...s.layout, nodes }, revision: s.revision + 1 });
  },

  setDatasetRef(ref) {
    const s = get();
    if (s.datasetRef === ref) return;
    set({ ...pushHistory(s), datasetRef: ref, revision: s.revision + 1 });
  },

  beginTransaction() {
    const s = get();
    if (!s.pending) set({ pending: snapshotOf(s) });
  },

  commitTransaction() {
    const s = get();
    if (!s.pending) return;
    const changed = s.pending.model !== s.model || s.pending.layout !== s.layout;
    if (!changed) {
      set({ pending: null });
      return;
    }
    const past = [...s.past, s.pending];
    set({
      pending: null,
      past: past.length > HISTORY_LIMIT ? past.slice(-HISTORY_LIMIT) : past,
      future: [],
      revision: s.revision + 1,
    });
  },

  cancelTransaction() {
    const s = get();
    if (s.pending) set({ model: s.pending.model, layout: s.pending.layout, pending: null });
  },

  undo() {
    const s = get();
    const prev = s.past.at(-1);
    if (!prev || s.pending) return;
    set({
      past: s.past.slice(0, -1),
      future: [snapshotOf(s), ...s.future],
      model: prev.model,
      layout: prev.layout,
      datasetRef: prev.datasetRef,
      selection: [],
      revision: s.revision + 1,
    });
  },

  redo() {
    const s = get();
    const next = s.future[0];
    if (!next || s.pending) return;
    set({
      future: s.future.slice(1),
      past: [...s.past, snapshotOf(s)],
      model: next.model,
      layout: next.layout,
      datasetRef: next.datasetRef,
      selection: [],
      revision: s.revision + 1,
    });
  },

  clearError() {
    set({ lastError: null });
  },

  paste(fragment, positions, offset) {
    const s = get();
    const { model, idMap } = ops.pasteFragment(s.model, fragment);
    const nodes = { ...s.layout.nodes };
    for (const [oldId, p] of Object.entries(positions)) {
      const nid = idMap.get(oldId);
      if (nid) nodes[nid] = { x: p.x + offset.x, y: p.y + offset.y };
    }
    const pastedNodes = [...idMap.entries()]
      .filter(([oldId]) => oldId in positions)
      .map(([, nid]) => nid);
    set({
      ...pushHistory(s),
      model,
      layout: { ...s.layout, nodes },
      selection: pastedNodes,
      lastError: null,
      revision: s.revision + 1,
    });
  },

  alignSelection(mode) {
    const s = get();
    const rects = new Map(
      s.selection
        .filter((id) => s.layout.nodes[id])
        .map((id) => [id, { ...s.layout.nodes[id]!, ...sizeOf(s.model, id, s.layout.settings) }]),
    );
    const pos = align(rects, mode);
    if (pos.size > 0) get().setPositions(Object.fromEntries(pos));
  },

  distributeSelection(axis) {
    const s = get();
    const rects = new Map(
      s.selection
        .filter((id) => s.layout.nodes[id])
        .map((id) => [id, { ...s.layout.nodes[id]!, ...sizeOf(s.model, id, s.layout.settings) }]),
    );
    const pos = distribute(rects, axis);
    if (pos.size === 0) return;
    // Distribution may produce fractional positions; round to whole pixels, not to the grid.
    get().setPositions(
      Object.fromEntries(
        [...pos].map(([id, p]) => [id, { x: Math.round(p.x), y: Math.round(p.y) }]),
      ),
    );
  },

  async autoArrange(opts) {
    const s = get();
    const computed = await computeAutoLayout(s.model, s.layout.settings);
    // The model may have changed while ELK ran; only apply to the model we laid out.
    if (get().model !== s.model) return;
    const nodes = mergeLayout(
      s.model,
      s.layout,
      computed,
      s.layout.settings,
      opts?.keepPinned ?? true,
    );
    const cur = get();
    set({
      ...pushHistory(cur),
      layout: { ...cur.layout, nodes: { ...cur.layout.nodes, ...nodes } },
      revision: cur.revision + 1,
    });
  },
}));

/** Position for a newly created node: snapped, offset from existing content. */
export function placementFor(layout: SemLayout, at?: Point): Point {
  const g = layout.settings.gridSize;
  if (at) return { x: snap(at.x, g), y: snap(at.y, g) };
  const ys = Object.values(layout.nodes).map((n) => n.y);
  return { x: snap(64, g), y: snap(ys.length ? Math.max(...ys) + 120 : 64, g) };
}
