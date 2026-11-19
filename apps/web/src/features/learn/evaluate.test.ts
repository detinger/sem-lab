import type { AnalysisConfiguration, SemModel } from '@sem-lab/contracts';
import { describe, expect, it } from 'vitest';
import {
  evaluateChoice,
  evaluateConfig,
  evaluateMapping,
  evaluateModel,
  evaluateNumber,
  evaluateSelfAssess,
  evaluateTask,
  parseNumberInput,
} from './evaluate';
import type { ModelCheck } from './schema';

const check: ModelCheck = {
  constructs: [
    {
      key: 'peu',
      aliases: ['Perceived ease of use', 'PEOU', 'PEU'],
      measurement: 'reflective',
      indicators: ['peu1', 'peu2'],
    },
    {
      key: 'pu',
      aliases: ['Perceived usefulness', 'PU'],
      measurement: 'reflective',
      indicators: ['pu1', 'pu2'],
    },
    { key: 'bi', aliases: ['Behavioural intention', 'BI'] },
  ],
  paths: [
    ['peu', 'pu'],
    ['pu', 'bi'],
  ],
  exactPaths: true,
  allowExtraConstructs: false,
};

function model(
  over: Partial<{
    order: 'fwd' | 'rev';
    prefix: string;
    paths: [string, string][];
    extra: boolean;
    pu: 'reflective' | 'composite-formative';
    puInd: string[];
  }> = {},
): SemModel {
  const p = over.prefix ?? '';
  const cons = [
    {
      id: `${p}c1`,
      name: ' perceived EASE of use ',
      measurement: 'reflective' as const,
      ids: ['peu1', 'peu2'],
    },
    {
      id: `${p}c2`,
      name: 'PU',
      measurement: over.pu ?? ('reflective' as const),
      ids: over.puInd ?? ['pu1', 'pu2'],
    },
    {
      id: `${p}c3`,
      name: 'Behavioural Intention',
      measurement: 'reflective' as const,
      ids: ['bi1'],
    },
    ...(over.extra
      ? [{ id: `${p}c4`, name: 'Trust', measurement: 'reflective' as const, ids: [] as string[] }]
      : []),
  ];
  const names = new Set(cons.flatMap((c) => c.ids));
  const idOf = (n: string): string => `${p}i_${n}`;
  const paths = over.paths ?? [
    ['c1', 'c2'],
    ['c2', 'c3'],
  ];
  const m: SemModel = {
    constructs: cons.map((c) => ({
      id: c.id,
      name: c.name,
      measurement: c.measurement,
      indicatorIds: c.ids.map(idOf),
    })),
    indicators: [...names].map((n) => ({ id: idOf(n), name: n.toUpperCase(), column: null })),
    relationships: paths.map(([s, t], i) => ({
      id: `r${i}`,
      kind: 'structural' as const,
      sourceId: `${p}${s}`,
      targetId: `${p}${t}`,
    })),
  };
  return over.order === 'rev'
    ? {
        constructs: [...m.constructs].reverse(),
        indicators: [...m.indicators].reverse(),
        relationships: [...m.relationships].reverse(),
      }
    : m;
}

describe('parseNumberInput', () => {
  it.each([
    ['0.35', 0.35],
    ['0,35', 0.35],
    [' −1,5 ', -1.5],
    ['1,234.5', 1234.5],
    ['1.234,5', 1234.5],
    ['.5', 0.5],
    ['2e-3', 0.002],
  ])('%s', (s, v) => expect(parseNumberInput(s)).toBeCloseTo(v, 12));
  it.each(['', 'abc', '1.2.3', '--1', '1,2,3x'])('rejects %j', (s) =>
    expect(parseNumberInput(s)).toBeNull(),
  );
});

describe('evaluateNumber', () => {
  const task = { answer: 0.35, tolerance: 0.01, feedbackCorrect: 'Yes.', feedbackWrong: 'No.' };
  it('accepts within tolerance, comma decimals and the boundary', () => {
    expect(evaluateNumber(task, '0.35').correct).toBe(true);
    expect(evaluateNumber(task, '0,36').correct).toBe(true);
    expect(evaluateNumber(task, '0.34').correct).toBe(true);
    expect(evaluateNumber(task, '0.37').correct).toBe(false);
    expect(evaluateNumber(task, '0.37').findings[0]).toMatchObject({
      status: 'wrong',
      text: 'No.',
    });
  });
  it('an unparsable or empty answer is a note, not a wrong attempt when empty', () => {
    expect(evaluateNumber(task, '').answered).toBe(false);
    const r = evaluateNumber(task, 'about a third');
    expect(r.correct).toBe(false);
    expect(r.findings[0]?.status).toBe('note');
  });
});

describe('evaluateChoice', () => {
  const single = {
    multiple: false,
    options: [
      { id: 'a', text: 'Alpha', correct: false, feedback: 'wrong a' },
      { id: 'b', text: 'Beta', correct: true, feedback: 'right b' },
    ],
  };
  const multi = {
    multiple: true,
    options: [
      { id: 'a', text: 'Alpha', correct: true, feedback: 'fa' },
      { id: 'b', text: 'Beta', correct: true, feedback: 'fb' },
      { id: 'c', text: 'Gamma', correct: false, feedback: 'fc' },
    ],
  };
  it('single choice gives per-option feedback', () => {
    expect(evaluateChoice(single, ['b']).correct).toBe(true);
    const r = evaluateChoice(single, ['a']);
    expect(r.correct).toBe(false);
    expect(r.findings).toEqual([{ status: 'wrong', text: 'Alpha: wrong a' }]);
    expect(evaluateChoice(single, []).answered).toBe(false);
  });
  it('multiple choice needs exactly the correct set', () => {
    expect(evaluateChoice(multi, ['a', 'b']).correct).toBe(true);
    expect(evaluateChoice(multi, ['b', 'a']).correct).toBe(true);
    const partial = evaluateChoice(multi, ['a']);
    expect(partial.correct).toBe(false);
    expect(partial.findings.map((x) => x.status)).toEqual(['ok', 'missing']);
    expect(evaluateChoice(multi, ['a', 'b', 'c']).correct).toBe(false);
  });
});

describe('evaluateModel', () => {
  it('accepts a correct model; aliases, case and whitespace do not matter', () => {
    const r = evaluateModel(check, model());
    expect(r.findings.filter((x) => x.status !== 'ok')).toEqual([]);
    expect(r.correct).toBe(true);
  });
  it('equivalent models score the same (order, ids, indicator case)', () => {
    const a = evaluateModel(check, model());
    const b = evaluateModel(check, model({ order: 'rev', prefix: 'zz_' }));
    expect(b.correct).toBe(a.correct);
    expect(b.findings.map((x) => x.text).sort()).toEqual(a.findings.map((x) => x.text).sort());
  });
  it('reports a missing path and an extra path', () => {
    const miss = evaluateModel(check, model({ paths: [['c1', 'c2']] }));
    expect(miss.correct).toBe(false);
    expect(miss.findings).toContainEqual({
      status: 'missing',
      text: 'Path PU → Behavioural Intention is missing.',
    });
    const extra = evaluateModel(
      check,
      model({
        paths: [
          ['c1', 'c2'],
          ['c2', 'c3'],
          ['c1', 'c3'],
        ],
      }),
    );
    expect(extra.correct).toBe(false);
    expect(extra.findings.some((x) => x.status === 'extra' && /not expected/.test(x.text))).toBe(
      true,
    );
  });
  it('extra paths are allowed (as notes) when exactPaths is false', () => {
    const r = evaluateModel(
      { ...check, exactPaths: false },
      model({
        paths: [
          ['c1', 'c2'],
          ['c2', 'c3'],
          ['c1', 'c3'],
        ],
      }),
    );
    expect(r.correct).toBe(true);
    expect(r.findings.some((x) => x.status === 'note')).toBe(true);
  });
  it('says when a path points the wrong way, without also calling it extra', () => {
    const r = evaluateModel(
      check,
      model({
        paths: [
          ['c2', 'c1'],
          ['c2', 'c3'],
        ],
      }),
    );
    expect(r.correct).toBe(false);
    expect(r.findings.some((x) => x.status === 'wrong' && /wrong way/.test(x.text))).toBe(true);
    expect(r.findings.some((x) => x.status === 'extra')).toBe(false);
  });
  it('flags wrong measurement and indicator set differences', () => {
    const m = evaluateModel(check, model({ pu: 'composite-formative' }));
    expect(
      m.findings.some((x) => x.status === 'wrong' && /should be reflective/.test(x.text)),
    ).toBe(true);
    const i = evaluateModel(check, model({ puInd: ['pu1', 'pu3'] }));
    expect(i.findings.some((x) => x.status === 'missing' && x.text.includes('“pu2”'))).toBe(true);
    expect(i.findings.some((x) => x.status === 'extra' && x.text.includes('“PU3”'))).toBe(true);
  });
  it('extra constructs are an error unless allowed', () => {
    const m = model({ extra: true });
    expect(evaluateModel(check, m).correct).toBe(false);
    const ok = evaluateModel({ ...check, allowExtraConstructs: true }, m);
    expect(ok.correct).toBe(true);
  });
  it('an empty model lists everything as missing', () => {
    const r = evaluateModel(check, { constructs: [], indicators: [], relationships: [] });
    expect(r.correct).toBe(false);
    expect(r.findings.filter((x) => x.status === 'missing').length).toBe(5);
  });
  it('ignores covariances and does not match one construct twice', () => {
    const m = model();
    m.relationships.push({ id: 'cv', kind: 'covariance', sourceId: 'c1', targetId: 'c3' });
    expect(evaluateModel(check, m).correct).toBe(true);
  });
});

describe('evaluateMapping', () => {
  const task = { expected: { x1: 'q1', x2: 'q2' }, reverse: [{ indicator: 'x2', min: 1, max: 7 }] };
  const ind = (name: string, column: string | null, extra: object = {}) => ({
    name,
    column,
    ...extra,
  });
  it('accepts correct columns and a reverse flag with the declared endpoints', () => {
    const r = evaluateMapping(task, {
      indicators: [
        ind('X1', 'q1'),
        ind('x2', 'q2', { reverseScored: true, scale: { min: 1, max: 7 } }),
      ],
      transformations: [],
    });
    expect(r.correct).toBe(true);
  });
  it('accepts a Data Lab reverse transformation mapped to the derived column', () => {
    const r = evaluateMapping(task, {
      indicators: [ind('x1', 'q1'), ind('x2', 'q2_rev')],
      transformations: [{ kind: 'reverse', column: 'q2', as: 'q2_rev', scale: { min: 1, max: 7 } }],
    });
    expect(r.correct).toBe(true);
  });
  it('explains wrong column, unmapped, missing reverse and wrong endpoints', () => {
    const r = evaluateMapping(task, {
      indicators: [ind('x1', 'q9'), ind('x2', null)],
      transformations: [],
    });
    expect(r.findings.map((x) => x.status)).toEqual(['wrong', 'missing']);
    const noRev = evaluateMapping(task, {
      indicators: [ind('x1', 'q1'), ind('x2', 'q2')],
      transformations: [],
    });
    expect(noRev.findings[1]).toMatchObject({ status: 'missing' });
    const bad = evaluateMapping(task, {
      indicators: [
        ind('x1', 'q1'),
        ind('x2', 'q2', { reverseScored: true, scale: { min: 1, max: 5 } }),
      ],
      transformations: [],
    });
    expect(bad.correct).toBe(false);
    expect(bad.findings[1]?.text).toMatch(/1–5.*1–7/);
    const missingInd = evaluateMapping(task, { indicators: [], transformations: [] });
    expect(missingInd.findings.every((x) => x.status === 'missing')).toBe(true);
  });
});

describe('evaluateConfig', () => {
  const base: AnalysisConfiguration = {
    method: 'pls-sem',
    engine: 'browser',
    estimator: 'pls-pm',
    missingData: 'listwise',
    bootstrap: {
      enabled: true,
      repetitions: 5000,
      ci: 'percentile',
      confidenceLevel: 0.95,
      sides: 'two-sided',
    },
    seed: 1,
    ipma: { targetConstructId: 'c_sat' },
  } as unknown as AnalysisConfiguration;
  const m = {
    constructs: [
      { id: 'c_sat', name: 'Satisfaction', measurement: 'reflective', indicatorIds: [] },
    ],
    indicators: [],
    relationships: [],
  } as SemModel;
  it('compares the stated subset only', () => {
    expect(evaluateConfig({ method: 'pls-sem', bootstrapAtLeast: 5000 }, base, null).correct).toBe(
      true,
    );
    expect(evaluateConfig({ bootstrapAtLeast: 10000 }, base, null).correct).toBe(false);
    expect(evaluateConfig({ method: 'cb-sem' }, base, null).findings[0]?.text).toMatch(
      /needs CB-SEM/,
    );
    expect(evaluateConfig({ ipmaTarget: 'satisfaction' }, base, null, m).correct).toBe(true);
    expect(evaluateConfig({ ipmaTarget: 'c_sat' }, base, null).correct).toBe(true);
    expect(evaluateConfig({ ipmaTarget: 'loyalty' }, base, null, m).correct).toBe(false);
    expect(
      evaluateConfig({ estimator: 'PLS-PM', missingData: 'listwise' }, base, null).correct,
    ).toBe(true);
  });
  it('explains an off bootstrap and invalid settings', () => {
    const off = { ...base, bootstrap: undefined } as AnalysisConfiguration;
    expect(evaluateConfig({ bootstrapAtLeast: 500 }, off, null).findings[0]?.text).toMatch(
      /Bootstrap is off/,
    );
    const bad = evaluateConfig({ method: 'pls-sem' }, null, 'A seed is required');
    expect(bad.correct).toBe(false);
    expect(bad.findings[0]?.text).toMatch(/A seed is required/);
  });
});

describe('evaluateSelfAssess and the dispatcher', () => {
  it('is complete when every item is ticked', () => {
    expect(evaluateSelfAssess(['a', 'b'], [true, true]).correct).toBe(true);
    const r = evaluateSelfAssess(['a', 'b'], [true, false]);
    expect(r.correct).toBe(false);
    expect(r.findings[1]?.status).toBe('missing');
  });
  it('dispatches by task kind', () => {
    const ctx = {
      model: model(),
      mapping: { indicators: [], transformations: [] },
      analysis: null,
      analysisProblem: null,
    };
    const t = { id: 'm', dimension: 'structure', prompt: 'x', kind: 'model', check } as never;
    expect(evaluateTask(t, {}, ctx).correct).toBe(true);
    const n = {
      id: 'n',
      dimension: 'numeric',
      prompt: 'x',
      kind: 'number',
      answer: 2,
      tolerance: 0.1,
      feedbackCorrect: 'y',
      feedbackWrong: 'n',
    } as never;
    expect(evaluateTask(n, { number: '2,05' }, ctx).correct).toBe(true);
  });
});
