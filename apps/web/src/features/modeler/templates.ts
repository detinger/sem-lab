/**
 * Starter models. Each is SEM Lab's own specification of a published theory; the citation
 * is shown with the template. Templates contain no data and no scale endpoints: endpoints are
 * properties of the instrument and are confirmed in the Data Lab when a dataset is mapped.
 */
import { type SemModel } from '@sem-lab/contracts';
import { EMPTY_MODEL, addConstruct, addIndicators, connect } from '@/domain/model-ops';

export interface ModelTemplate {
  id: string;
  title: string;
  description: string;
  citation: string;
  build(): SemModel;
}

interface Spec {
  name: string;
  label: string;
  indicators: string[];
}

function fromSpec(constructs: Spec[], paths: Array<[string, string, string?]>): SemModel {
  let m = EMPTY_MODEL;
  const ids = new Map<string, string>();
  for (const c of constructs) {
    const r = addConstruct(m, { name: c.name, label: c.label });
    ids.set(c.name, r.id);
    m = addIndicators(
      r.model,
      r.id,
      c.indicators.map((name) => ({ name })),
    ).model;
  }
  paths.forEach(([from, to, hypothesis]) => {
    const r = connect(m, ids.get(from)!, ids.get(to)!);
    m = hypothesis
      ? {
          ...r.model,
          relationships: r.model.relationships.map((x) =>
            x.id === r.relationshipId ? { ...x, hypothesis } : x,
          ),
        }
      : r.model;
  });
  return m;
}

export const TEMPLATES: ModelTemplate[] = [
  {
    id: 'tam',
    title: 'Technology Acceptance Model (TAM)',
    description:
      'Perceived ease of use and perceived usefulness shape attitude, intention and use. Indicator codes match the bundled TAM sample data.',
    citation:
      'Davis, F. D. (1989). Perceived usefulness, perceived ease of use, and user acceptance of information technology. MIS Quarterly, 13(3), 319–340.',
    build: () =>
      fromSpec(
        [
          {
            name: 'PEOU',
            label: 'Perceived ease of use',
            indicators: ['EOU1', 'EOU2', 'EOU3', 'EOU4', 'EOU5'],
          },
          {
            name: 'PU',
            label: 'Perceived usefulness',
            indicators: ['USEF1', 'USEF2', 'USEF3', 'USEF4', 'USEF5'],
          },
          {
            name: 'ATU',
            label: 'Attitude toward using',
            indicators: ['ATT1', 'ATT2', 'ATT3', 'ATT4', 'ATT5'],
          },
          { name: 'BI', label: 'Behavioral intention', indicators: ['BI1', 'BI2', 'BI3'] },
          { name: 'USE', label: 'System use', indicators: ['USE1', 'USE2', 'USE3', 'USE4'] },
        ],
        [
          ['PEOU', 'PU', 'H1'],
          ['PEOU', 'ATU', 'H2'],
          ['PU', 'ATU', 'H3'],
          ['PU', 'BI', 'H4'],
          ['ATU', 'BI', 'H5'],
          ['BI', 'USE', 'H6'],
        ],
      ),
  },
  {
    id: 'two-construct',
    title: 'Two constructs',
    description:
      'One predictor and one outcome, three indicators each — the smallest structural model.',
    citation: 'Generic starting point; no theory implied.',
    build: () =>
      fromSpec(
        [
          { name: 'X', label: 'Predictor', indicators: ['x1', 'x2', 'x3'] },
          { name: 'Y', label: 'Outcome', indicators: ['y1', 'y2', 'y3'] },
        ],
        [['X', 'Y', 'H1']],
      ),
  },
];
