/**
 * Plain-JSON SemModel fixtures used to seed the Modeler in e2e tests through
 * `window.__semLabTest.loadModel`. They replace the former in-app template picker: the specs
 * mirror the models it used to build (TAM and the two-construct starter), kept here so the tests
 * stay independent of any app UI for setting a model up.
 */

interface Spec {
  name: string;
  label: string;
  indicators: string[];
}

const id = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');

/** Build a reflective-measurement SemModel from construct specs and structural paths. */
function build(specs: Spec[], paths: Array<[string, string, string]>): unknown {
  const constructs = specs.map((s) => ({
    id: `c_${id(s.name)}`,
    name: s.name,
    label: s.label,
    measurement: 'reflective' as const,
    indicatorIds: s.indicators.map((n) => `i_${id(n)}`),
  }));
  const indicators = specs.flatMap((s) =>
    s.indicators.map((n) => ({ id: `i_${id(n)}`, name: n, column: n })),
  );
  const relationships = paths.map(([from, to, hypothesis], i) => ({
    id: `r_${i + 1}`,
    sourceId: `c_${id(from)}`,
    targetId: `c_${id(to)}`,
    kind: 'structural' as const,
    hypothesis,
  }));
  return { constructs, indicators, relationships };
}

/** Technology Acceptance Model: 5 constructs, 22 indicators, 6 structural paths. */
export const TAM_MODEL = build(
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
);

/** The smallest structural model: one predictor, one outcome, three indicators each. */
export const TWO_CONSTRUCT_MODEL = build(
  [
    { name: 'X', label: 'Predictor', indicators: ['x1', 'x2', 'x3'] },
    { name: 'Y', label: 'Outcome', indicators: ['y1', 'y2', 'y3'] },
  ],
  [['X', 'Y', 'H1']],
);
