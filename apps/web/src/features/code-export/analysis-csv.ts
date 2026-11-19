import type { AnalysisData } from '@/domain/dataset/types';

/** CSV of the analysis matrix: RFC 4180, '.' decimals, empty field = missing (FIML only). */
export function analysisCsv(data: AnalysisData): string {
  const q = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [data.columns.map(q).join(',')];
  for (const row of data.rows) lines.push(row.map((v) => (v === null ? '' : String(v))).join(','));
  return `${lines.join('\n')}\n`;
}
