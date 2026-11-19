/**
 * Which challenge the student is working on, and whether the docked panel is open. Tiny and
 * dependency-free on purpose: the app shell imports it eagerly, the heavy panel is lazy-loaded.
 * The choice is a per-viewer convenience kept in localStorage (read and written defensively).
 */
import { create } from 'zustand';

export const ACTIVE_CHALLENGE_KEY = 'sem-lab:active-challenge';

function read(): { id: string | null; open: boolean } {
  try {
    const raw = window.localStorage.getItem(ACTIVE_CHALLENGE_KEY);
    if (!raw) return { id: null, open: true };
    const v = JSON.parse(raw) as { id?: unknown; open?: unknown };
    return { id: typeof v.id === 'string' ? v.id : null, open: v.open !== false };
  } catch {
    return { id: null, open: true };
  }
}

function write(id: string | null, open: boolean): void {
  try {
    if (id === null) window.localStorage.removeItem(ACTIVE_CHALLENGE_KEY);
    else window.localStorage.setItem(ACTIVE_CHALLENGE_KEY, JSON.stringify({ id, open }));
  } catch {
    /* storage unavailable: the panel still works for this visit */
  }
}

interface ActiveState {
  challengeId: string | null;
  open: boolean;
  start: (id: string) => void;
  stop: () => void;
  setOpen: (open: boolean) => void;
}

const initial = read();

export const useActiveChallenge = create<ActiveState>()((set, get) => ({
  challengeId: initial.id,
  open: initial.open,
  start: (id) => {
    set({ challengeId: id, open: true });
    write(id, true);
  },
  stop: () => {
    set({ challengeId: null, open: true });
    write(null, true);
  },
  setOpen: (open) => {
    set({ open });
    write(get().challengeId, open);
  },
}));

/** Pages that a challenge can be worked on (the dock is shown on these). */
export const DOCK_PATHS = ['/modeler', '/data', '/analysis', '/results'] as const;
