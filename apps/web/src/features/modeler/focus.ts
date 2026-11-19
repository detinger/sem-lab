/**
 * "Focus request": another page (IPMA) asks the Modeler to highlight a set of element ids
 * (constructs, relationships, indicators). The Modeler selects them, draws them focused and
 * offers "Clear focus". It holds ids only, never data.
 */
import { create } from 'zustand';

export interface FocusRequest {
  ids: string[];
  /** human-readable reason shown in the Modeler, e.g. "IPMA: supporting paths of PU" */
  reason: string;
  nonce: number;
}

interface FocusState {
  request: FocusRequest | null;
  focus: (ids: string[], reason: string) => void;
  clear: () => void;
}

let nonce = 0;
export const useFocusRequest = create<FocusState>()((set) => ({
  request: null,
  focus: (ids, reason) => set({ request: { ids: [...new Set(ids)], reason, nonce: ++nonce } }),
  clear: () => set({ request: null }),
}));
