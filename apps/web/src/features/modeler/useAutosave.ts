import { useEffect, useRef, useState } from 'react';
import { saveProject } from '@/storage/projects';
import { useModeler } from './store';

export const LAST_PROJECT_KEY = 'sem-studio.lastProjectId';

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; at: string }
  | { status: 'error'; message: string };

/**
 * Debounced autosave of the open project to IndexedDB (PLAN §2.1 "Autosave drafts in
 * IndexedDB"). Saves only after a committed change (revision bump), never mid-drag.
 */
export function useAutosave(delayMs = 800): SaveState {
  const revision = useModeler((s) => s.revision);
  const pending = useModeler((s) => s.pending);
  const [state, setState] = useState<SaveState>({ status: 'idle' });
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (pending) return;
    const timer = window.setTimeout(() => {
      const s = useModeler.getState();
      if (s.model.constructs.length === 0 && s.model.indicators.length === 0) return;
      const now = new Date().toISOString();
      setState({ status: 'saving' });
      saveProject(s.toProject(now))
        .then(() => {
          try {
            localStorage.setItem(LAST_PROJECT_KEY, s.projectId);
          } catch {
            /* storage may be unavailable (private mode); autosave in IndexedDB still worked */
          }
          setState({ status: 'saved', at: now });
        })
        .catch((e: unknown) =>
          setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
        );
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [revision, pending, delayMs]);

  return state;
}

export function readLastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}
