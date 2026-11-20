import { useCallback, useState } from 'react';

export const PANELS_STORAGE_KEY = 'sem-lab:modeler-panels';

export interface PanelState {
  paletteOpen: boolean;
  paletteWidth: number;
  inspectorOpen: boolean;
  inspectorWidth: number;
}

/** Both side panels start closed; the canvas gets the room until the user opens one. */
export const DEFAULT_PANELS: PanelState = {
  paletteOpen: false,
  paletteWidth: 300,
  inspectorOpen: false,
  inspectorWidth: 420,
};

function read(): PanelState {
  try {
    const raw = window.localStorage.getItem(PANELS_STORAGE_KEY);
    if (!raw) return DEFAULT_PANELS;
    const v = JSON.parse(raw) as Partial<Record<keyof PanelState, unknown>>;
    const bool = (x: unknown, d: boolean): boolean => (typeof x === 'boolean' ? x : d);
    const num = (x: unknown, d: number): number =>
      typeof x === 'number' && Number.isFinite(x) ? x : d;
    return {
      paletteOpen: bool(v.paletteOpen, DEFAULT_PANELS.paletteOpen),
      paletteWidth: num(v.paletteWidth, DEFAULT_PANELS.paletteWidth),
      inspectorOpen: bool(v.inspectorOpen, DEFAULT_PANELS.inspectorOpen),
      inspectorWidth: num(v.inspectorWidth, DEFAULT_PANELS.inspectorWidth),
    };
  } catch {
    return DEFAULT_PANELS;
  }
}

/**
 * Modeler side panels (data indicators, inspector): open/closed and width, remembered in
 * localStorage so they stay as left across page changes and reloads. Never fatal if storage is
 * unavailable: the panels then just start closed.
 */
export function usePanelState(): [
  PanelState,
  (update: (s: PanelState) => Partial<PanelState>) => void,
] {
  const [state, setState] = useState(read);
  const update = useCallback((fn: (s: PanelState) => Partial<PanelState>) => {
    setState((current) => {
      const next = { ...current, ...fn(current) };
      try {
        window.localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Not remembering the layout is acceptable.
      }
      return next;
    });
  }, []);
  return [state, update];
}
