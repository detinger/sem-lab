import { useEffect, useRef, useState } from 'react';
import { saveProject } from '@/storage/projects';
import { useModeler } from './store';

export const LAST_PROJECT_KEY = 'sem-lab.lastProjectId';

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
  /** a committed change is waiting for its debounce timer */
  const dirty = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (pending) return;
    dirty.current = true;
    const timer = window.setTimeout(() => {
      dirty.current = false;
      setState({ status: 'saving' });
      void saveNow().then((result) => {
        if (mounted.current && result) setState(result);
      });
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [revision, pending, delayMs]);

  // Leaving the page inside the debounce window must not drop the last edit.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (dirty.current) {
        dirty.current = false;
        void saveNow();
      }
    };
  }, []);

  return state;
}

/** Saves the open project (unless it is empty); resolves to the resulting state, or null if skipped. */
async function saveNow(): Promise<SaveState | null> {
  const s = useModeler.getState();
  if (s.model.constructs.length === 0 && s.model.indicators.length === 0) return null;
  const now = new Date().toISOString();
  try {
    await saveProject(s.toProject(now));
  } catch (e: unknown) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
  try {
    localStorage.setItem(LAST_PROJECT_KEY, s.projectId);
  } catch {
    /* storage may be unavailable (private mode); autosave in IndexedDB still worked */
  }
  return { status: 'saved', at: now };
}

export function readLastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}
