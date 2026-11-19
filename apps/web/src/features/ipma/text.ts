/**
 * IPMA wording and tables. All text is descriptive and neutral: it reports numbers and what
 * they are, never that changing a construct would change the target (STYLE §11, PLAN §2.8).
 */
import type { ReportTable } from '../reports/table';
import { formatNumber } from '../reports/format';
import type { IpmaPoint, Level } from './data';

export const FOOTNOTE =
  'Performance uses original survey scale endpoints. Importance is the total effect on the selected target.';

export const INTERPRETATION_CARD =
  'Higher importance with lower performance deserves investigation, not an automatic directive. IPMA is descriptive decision support, not causal proof that improving a construct will change the target.';

export const NO_INTERVAL_NOTE = 'Point estimate — no interval in this version';

export const MISSING_ENDPOINTS_CALLOUT =
  'Set the permitted minimum and maximum for each indicator to calculate performance.';

const f = (v: number): string => formatNumber(v, { decimals: 3 });
const p1 = (v: number): string => formatNumber(v, { decimals: 1 });

export const predecessorText = (t: IpmaPoint['predecessor']): string =>
  t === 'direct' ? 'Direct predecessor' : 'Indirect predecessor';

export function ipmaTable(
  points: readonly IpmaPoint[],
  o: { targetName: string; level: Level; scopeText: string; convention: string },
): ReportTable {
  const what = o.level === 'indicators' ? 'Indicator' : 'Construct';
  return {
    id: 'ipma',
    title: 'IPMA data',
    caption: `Table. Importance-performance map analysis, target: ${o.targetName} (${o.scopeText})`,
    columns: [
      { key: 'name', label: what, align: 'left' },
      { key: 'importance', label: 'Importance', align: 'right', numeric: true },
      { key: 'performance', label: 'Performance', align: 'right', numeric: true },
      { key: 'predecessor', label: 'Predecessor', align: 'left' },
      { key: 'rank', label: 'Rank by importance', align: 'right', numeric: true },
    ],
    rows: points.map((p) => ({
      name: p.label,
      importance: f(p.importance),
      performance: p1(p.performance),
      predecessor: p.predecessor === 'direct' ? 'Direct' : 'Indirect',
      rank: String(p.rank),
    })),
    notes: [FOOTNOTE, `Point estimates; no interval in this version. ${o.convention}`],
  };
}

/** Neutral, number-generated summary for a report. Never causal. */
export function interpretationText(
  points: readonly IpmaPoint[],
  o: { targetName: string; level: Level },
): string {
  const noun = o.level === 'indicators' ? 'indicators' : 'constructs';
  if (points.length === 0) return `No ${noun} are displayed for the target ${o.targetName}.`;
  const byImp = [...points].sort((a, b) => b.importance - a.importance);
  const byPerf = [...points].sort((a, b) => a.performance - b.performance);
  const top = byImp[0]!;
  const low = byPerf[0]!;
  const lines: string[] = [];
  lines.push(
    `Importance-performance map analysis for the target ${o.targetName}, ${points.length} ${noun} displayed. Importance is the total effect on the target (signed, as estimated); performance is on a 0–100 scale from the original survey scale endpoints.`,
  );
  lines.push(
    `Importance ranges from ${f(byImp[byImp.length - 1]!.importance)} to ${f(top.importance)}; performance ranges from ${p1(low.performance)} to ${p1(byPerf[byPerf.length - 1]!.performance)}.`,
  );
  lines.push(
    `${top.label} has the highest importance (${f(top.importance)}) with a performance of ${p1(top.performance)}. ${low.label} has the lowest performance (${p1(low.performance)}) with an importance of ${f(low.importance)}.`,
  );
  const neg = points.filter((p) => p.importance < 0);
  if (neg.length > 0)
    lines.push(
      `${neg.map((p) => `${p.label} (${f(p.importance)})`).join(', ')} ${neg.length === 1 ? 'has' : 'have'} a negative total effect on the target; the sign is kept.`,
    );
  lines.push(
    'Higher importance with lower performance deserves investigation, not an automatic directive. This map describes the estimated model and is not causal evidence that changing a construct would change the target. Values are point estimates without intervals.',
  );
  return lines.join(' ');
}

export function pointSummary(p: IpmaPoint, targetName: string): string {
  return `${p.label}: importance ${f(p.importance)}, performance ${p1(p.performance)} of 100, ${predecessorText(p.predecessor).toLowerCase()} of ${targetName}, rank ${p.rank} by importance.`;
}
