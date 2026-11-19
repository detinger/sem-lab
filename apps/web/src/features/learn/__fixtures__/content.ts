/**
 * Small, schema-valid test content for the Learn / Challenges / Reference UI. Used by unit tests
 * and, through the development-only fixture flag (see ../content.ts), by the Playwright specs.
 * Real content lives in content/ and is written separately.
 */
import type { SemModel } from '@sem-studio/contracts';
import type { ContentSet } from '../content';
import { Challenge, Lesson, Theory, GlossaryTerm } from '../schema';

const construct = (id: string, name: string, indicatorIds: string[]) => ({
  id,
  name,
  measurement: 'reflective' as const,
  indicatorIds,
});
const indicator = (id: string, name: string) => ({ id, name, column: null });

export const tamModel: SemModel = {
  constructs: [
    construct('c_peou', 'PEOU', ['i_e1', 'i_e2']),
    construct('c_pu', 'PU', ['i_u1', 'i_u2']),
    construct('c_bi', 'BI', ['i_b1', 'i_b2']),
  ],
  indicators: [
    indicator('i_e1', 'peou1'),
    indicator('i_e2', 'peou2'),
    indicator('i_u1', 'pu1'),
    indicator('i_u2', 'pu2'),
    indicator('i_b1', 'bi1'),
    indicator('i_b2', 'bi2'),
  ],
  relationships: [
    { id: 'r1', kind: 'structural', sourceId: 'c_peou', targetId: 'c_pu' },
    { id: 'r2', kind: 'structural', sourceId: 'c_pu', targetId: 'c_bi' },
  ],
};

/** The starting point of the model challenge: constructs only, no paths. */
export const tamStarter: SemModel = { ...tamModel, relationships: [] };

const lessons = [
  Lesson.parse({
    id: 'what-is-a-construct',
    level: 1,
    order: 1,
    title: 'What is a construct?',
    summary: 'A construct is an unobserved concept measured through several indicators.',
    minutes: 5,
    body: [
      {
        kind: 'p',
        text: 'A **construct** such as [[reliability]] cannot be observed directly; we measure it with *indicators* like `peou1`.',
      },
      {
        kind: 'diagram',
        model: tamStarter,
        caption: 'Three constructs, each with two indicators.',
        highlight: ['c_pu'],
      },
      {
        kind: 'formula',
        display: 'AVE = Σλ² / k',
        explanation: 'λ is a standardized loading and k the number of indicators.',
      },
      { kind: 'demo', demo: 'vif', initial: { r2: 0.8 }, caption: 'Move the slider.' },
      { kind: 'callout', variant: 'tip', title: 'Tip', text: 'Name constructs in words.' },
      { kind: 'list', ordered: false, items: ['One concept', 'Several indicators'] },
    ],
    mistake: {
      title: 'One item is not a construct',
      text: 'Do not treat a **single item** as a scale.',
    },
    tryIt: {
      task: 'Open the starter and add the two paths.',
      starter: { title: 'TAM starter', model: tamStarter, open: 'modeler' },
    },
    checks: [
      {
        id: 'q-direction',
        question: 'In a reflective measurement model, which way do the arrows point?',
        options: [
          {
            id: 'a',
            text: 'From indicators to the construct',
            correct: false,
            feedback: 'That is the formative direction.',
          },
          {
            id: 'b',
            text: 'From the construct to its indicators',
            correct: true,
            feedback: 'Yes: the construct causes the indicators.',
          },
        ],
        explanation: 'Reflective indicators are effects of the construct.',
      },
    ],
    references: ['hair2022', 'fxsmith2020'],
    glossary: ['reliability'],
  }),
  Lesson.parse({
    id: 'reliability-basics',
    level: 2,
    order: 1,
    title: 'Reliability basics',
    summary: 'Reliability says how consistently indicators measure a construct.',
    minutes: 6,
    prerequisites: ['what-is-a-construct'],
    body: [
      { kind: 'p', text: 'Reliability is about consistency.' },
      { kind: 'demo', demo: 'reliability-from-loadings', initial: {} },
    ],
    mistake: {
      title: 'Alpha is not validity',
      text: 'A high α does not show that you measure the right thing.',
    },
    checks: [
      {
        id: 'q-threshold',
        question: 'Select all that are common guidelines.',
        multiple: true,
        options: [
          { id: 'a', text: 'ρC ≥ .70', correct: true, feedback: 'A common guideline.' },
          { id: 'b', text: 'AVE ≥ .50', correct: true, feedback: 'A common guideline.' },
          { id: 'c', text: 'AVE ≥ 1.5', correct: false, feedback: 'AVE cannot exceed 1.' },
        ],
        explanation: 'These are heuristics, not tests.',
      },
    ],
    references: ['hair2022'],
  }),
];

const challenges = [
  Challenge.parse({
    id: 'draw-the-tam',
    number: 1,
    title: 'Draw the TAM',
    category: 'model',
    method: 'pls',
    difficulty: 1,
    prerequisiteLessons: ['what-is-a-construct'],
    skills: ['Specify a structural model'],
    brief: [{ kind: 'p', text: 'Build the **technology acceptance model**: PEOU → PU → BI.' }],
    starter: { title: 'TAM challenge', model: tamStarter, open: 'modeler' },
    tasks: [
      {
        id: 'draw',
        kind: 'model',
        dimension: 'structure',
        prompt: 'Add the structural paths PEOU → PU and PU → BI in the Modeler.',
        check: {
          constructs: [
            { key: 'peou', aliases: ['PEOU', 'Perceived ease of use'], measurement: 'reflective' },
            { key: 'pu', aliases: ['PU', 'Perceived usefulness'], measurement: 'reflective' },
            { key: 'bi', aliases: ['BI', 'Behavioural intention'], measurement: 'reflective' },
          ],
          paths: [
            ['peou', 'pu'],
            ['pu', 'bi'],
          ],
          exactPaths: true,
          allowExtraConstructs: false,
        },
      },
    ],
    hints: [
      'Think about the order of the acceptance process.',
      'Ease of use comes first.',
      'Two arrows, both left to right.',
    ],
    solution: [{ kind: 'p', text: 'PEOU → PU → BI.' }],
  }),
  Challenge.parse({
    id: 'interpret-vif',
    number: 2,
    title: 'Read the VIF',
    category: 'interpret',
    method: 'both',
    difficulty: 2,
    skills: ['Judge collinearity', 'Interpret VIF'],
    brief: [{ kind: 'p', text: 'A predictor has R² = .80 on the other predictors.' }],
    tasks: [
      {
        id: 'compute',
        kind: 'number',
        dimension: 'numeric',
        prompt: 'What is the VIF?',
        answer: 5,
        tolerance: 0.05,
        feedbackCorrect: 'VIF = 1 / (1 − .80) = 5.',
        feedbackWrong: 'Use VIF = 1 / (1 − R²).',
      },
      {
        id: 'judge',
        kind: 'choice',
        dimension: 'interpretation',
        prompt: 'Is this a concern under common guidelines?',
        options: [
          {
            id: 'a',
            text: 'Yes, it reaches the usual limit of 5',
            correct: true,
            feedback: 'Right: a heuristic limit.',
          },
          {
            id: 'b',
            text: 'No, any VIF below 10 is fine',
            correct: false,
            feedback: '10 is a very lenient rule for regression, not for PLS-SEM.',
          },
        ],
      },
      {
        id: 'report',
        kind: 'self-assess',
        dimension: 'reporting',
        prompt: 'Tick what your write-up contains.',
        checklist: ['The VIF value', 'The guideline used'],
      },
    ],
    hints: ['Plug R² into the formula.', 'Subtract first, then divide.'],
    solution: [{ kind: 'p', text: 'VIF = 5: right at the common limit.' }],
  }),
];

const glossary = [
  GlossaryTerm.parse({
    id: 'reliability',
    term: 'Reliability',
    aliases: ['internal consistency'],
    definition: 'How **consistently** indicators measure the same construct.',
    lessons: ['reliability-basics'],
    seeAlso: ['ave'],
  }),
  GlossaryTerm.parse({
    id: 'ave',
    term: 'Average variance extracted (AVE)',
    aliases: ['AVE'],
    definition: 'The mean of the squared standardized loadings of a construct.',
  }),
];

const theories = [
  Theory.parse({
    id: 'tam',
    name: 'Technology Acceptance Model',
    field: 'Information systems',
    summary: 'Perceived usefulness and ease of use explain intention to use a technology.',
    constructs: [
      { name: 'Perceived ease of use', abbreviation: 'PEOU', definition: 'Effort-free use.' },
      { name: 'Perceived usefulness', abbreviation: 'PU', definition: 'Improved performance.' },
    ],
    relationships: ['PEOU → PU', 'PU → BI'],
    model: tamModel,
    examples: ['tam-mediation'],
    notebooks: ['01_tam_pls_sem'],
    references: ['fxsmith2020'],
    caveats: 'Synthetic example data only.',
  }),
];

export const fixtureContent: ContentSet = {
  lessons,
  challenges,
  glossary,
  theories,
  citations: [
    { key: 'fxsmith2020', text: 'Smith, A. (2020). A fixture citation. Journal of Tests.' },
  ],
};
