import { create } from 'zustand';
import type { NumberStyle } from '../reports/format';

/** CB-SEM: which scale the tables and the Modeler overlay show. */
export type EstimateScale = 'standardized' | 'unstandardized';

/** Presentation choices that apply to every table on the Results page. */
interface ResultStyleState {
  decimals: 2 | 3;
  /** APA-style: no leading zero for quantities bounded by 1 */
  apa: boolean;
  /** CB-SEM tables and the Modeler overlay */
  scale: EstimateScale;
  includeCaption: boolean;
  includeNotes: boolean;
  set: (patch: Partial<Omit<ResultStyleState, 'set'>>) => void;
}

export const useResultStyle = create<ResultStyleState>()((set) => ({
  decimals: 3,
  apa: false,
  scale: 'standardized',
  includeCaption: true,
  includeNotes: true,
  set: (patch) => set(patch),
}));

export const styleOf = (s: Pick<ResultStyleState, 'decimals' | 'apa'>): Partial<NumberStyle> => ({
  decimals: s.decimals,
  leadingZero: !s.apa,
});
