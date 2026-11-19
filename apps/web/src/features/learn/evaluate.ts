/**
 * Challenge evaluators: pure functions from a student's answer (or the app's current state) to
 * a verdict plus feedback findings. Nothing here reads a store; the workspace context
 * (context.ts) passes the current modeler model, Data Lab mapping and analysis configuration in.
 *
 * Every finding carries a status AND a sentence, so feedback is never conveyed by colour alone.
 */
import type { AnalysisConfiguration, SemModel } from '@sem-studio/contracts';
import type { ModelCheck, Task } from './schema';

export type FindingStatus = 'ok' | 'missing' | 'wrong' | 'extra' | 'note';

export interface Finding {
  status: FindingStatus;
  text: string;
}

export interface TaskResult {
  correct: boolean;
  /** false when nothing was answered yet: not counted as an attempt */
  answered: boolean;
  findings: Finding[];
}

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();
const list = (xs: string[]): string => xs.map((x) => `“${x}”`).join(', ');
const f = (status: FindingStatus, text: string): Finding => ({ status, text });

const finish = (findings: Finding[], answered = true): TaskResult => ({
  correct: answered && findings.every((x) => x.status === 'ok' || x.status === 'note'),
  answered,
  findings,
});

// ---- choice -----------------------------------------------------------------------------------

interface ChoiceTask {
  multiple: boolean;
  options: { id: string; text: string; correct: boolean; feedback: string }[];
}

export function evaluateChoice(task: ChoiceTask, selected: readonly string[]): TaskResult {
  if (selected.length === 0)
    return { correct: false, answered: false, findings: [f('note', 'Choose an answer first.')] };
  const chosen = new Set(selected);
  const findings: Finding[] = [];
  for (const o of task.options) {
    if (chosen.has(o.id)) findings.push(f(o.correct ? 'ok' : 'wrong', `${o.text}: ${o.feedback}`));
    else if (o.correct && task.multiple)
      findings.push(f('missing', `You did not select “${o.text}”: ${o.feedback}`));
  }
  return finish(findings);
}

// ---- number -----------------------------------------------------------------------------------

/** Parse a number typed by a student: accepts a decimal point or comma, and a Unicode minus. */
export function parseNumberInput(raw: string): number | null {
  let s = raw.trim().replace(/[−–]/g, '-').replace(/\s/g, '');
  if (s === '') return null;
  if (s.includes(',') && s.includes('.')) {
    // "1,234.5" (comma thousands) or "1.234,5" (period thousands): the last separator is decimal
    s =
      s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.split(',').length === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function evaluateNumber(
  task: { answer: number; tolerance: number; feedbackCorrect: string; feedbackWrong: string },
  raw: string,
): TaskResult {
  const v = parseNumberInput(raw);
  if (v === null)
    return {
      correct: false,
      answered: raw.trim() !== '',
      findings: [f('note', 'Enter a number (a decimal point or comma is fine).')],
    };
  // A small epsilon keeps |x − answer| ≤ tolerance true at the boundary despite float error.
  return Math.abs(v - task.answer) <= task.tolerance + 1e-12
    ? finish([f('ok', task.feedbackCorrect)])
    : finish([f('wrong', task.feedbackWrong)]);
}

// ---- model ------------------------------------------------------------------------------------

export function evaluateModel(check: ModelCheck, model: SemModel): TaskResult {
  const findings: Finding[] = [];
  const indicatorName = new Map(model.indicators.map((i) => [i.id, i.name]));
  const claimed = new Set<string>();
  /** expected key → model construct id */
  const keyToId = new Map<string, string>();

  for (const exp of check.constructs) {
    const aliases = new Set(exp.aliases.map(norm));
    const hit = model.constructs.find((c) => aliases.has(norm(c.name)) && !claimed.has(c.id));
    const display = exp.aliases[0] ?? exp.key;
    if (!hit) {
      findings.push(
        f(
          'missing',
          `No construct named “${display}”${exp.aliases.length > 1 ? ` (or ${list(exp.aliases.slice(1))})` : ''}.`,
        ),
      );
      continue;
    }
    claimed.add(hit.id);
    keyToId.set(exp.key, hit.id);
    let ok = true;
    if (exp.measurement && hit.measurement !== exp.measurement) {
      ok = false;
      findings.push(
        f(
          'wrong',
          exp.measurement === 'reflective'
            ? `“${hit.name}” should be reflective (the construct causes its indicators) but is set as a composite.`
            : `“${hit.name}” should be a composite (formative: the indicators form the construct) but is set as reflective.`,
        ),
      );
    }
    if (exp.indicators) {
      const have = new Map<string, string>();
      for (const id of hit.indicatorIds) {
        const name = indicatorName.get(id);
        if (name) have.set(norm(name), name);
      }
      const want = new Map(exp.indicators.map((n) => [norm(n), n]));
      const missing = [...want].filter(([k]) => !have.has(k)).map(([, n]) => n);
      const extra = [...have].filter(([k]) => !want.has(k)).map(([, n]) => n);
      if (missing.length > 0) {
        ok = false;
        findings.push(f('missing', `“${hit.name}” is missing indicator(s) ${list(missing)}.`));
      }
      if (extra.length > 0) {
        ok = false;
        findings.push(f('extra', `“${hit.name}” has unexpected indicator(s) ${list(extra)}.`));
      }
    }
    if (ok) findings.push(f('ok', `Construct “${hit.name}” is set up as expected.`));
  }

  const extraConstructs = model.constructs.filter((c) => !claimed.has(c.id));
  if (extraConstructs.length > 0)
    findings.push(
      f(
        check.allowExtraConstructs ? 'note' : 'extra',
        `Extra construct(s) ${list(extraConstructs.map((c) => c.name))}${check.allowExtraConstructs ? ' (allowed)' : ' are not part of this task'}.`,
      ),
    );

  const idToKey = new Map([...keyToId].map(([k, id]) => [id, k]));
  const nameOfKey = (k: string): string => {
    const id = keyToId.get(k);
    return (
      model.constructs.find((c) => c.id === id)?.name ??
      check.constructs.find((c) => c.key === k)?.aliases[0] ??
      k
    );
  };
  const structural = new Set<string>();
  for (const r of model.relationships) {
    if (r.kind !== 'structural') continue;
    const s = idToKey.get(r.sourceId);
    const t = idToKey.get(r.targetId);
    if (s && t) structural.add(`${s}>${t}`);
  }
  const expected = new Set(check.paths.map(([s, t]) => `${s}>${t}`));
  for (const [s, t] of check.paths) {
    if (!keyToId.has(s) || !keyToId.has(t)) {
      findings.push(
        f(
          'missing',
          `Path ${nameOfKey(s)} → ${nameOfKey(t)} cannot exist until both constructs do.`,
        ),
      );
    } else if (structural.has(`${s}>${t}`)) {
      findings.push(f('ok', `Path ${nameOfKey(s)} → ${nameOfKey(t)} is present.`));
    } else if (structural.has(`${t}>${s}`)) {
      findings.push(
        f(
          'wrong',
          `The path between ${nameOfKey(s)} and ${nameOfKey(t)} points the wrong way: it should run ${nameOfKey(s)} → ${nameOfKey(t)}.`,
        ),
      );
    } else findings.push(f('missing', `Path ${nameOfKey(s)} → ${nameOfKey(t)} is missing.`));
  }
  for (const p of structural) {
    if (expected.has(p)) continue;
    const [s = '', t = ''] = p.split('>');
    // A reversed expected path was already reported as "wrong way".
    if (expected.has(`${t}>${s}`)) continue;
    findings.push(
      f(
        check.exactPaths ? 'extra' : 'note',
        `Path ${nameOfKey(s)} → ${nameOfKey(t)} is not expected${check.exactPaths ? ' here' : ' (allowed)'}.`,
      ),
    );
  }
  return finish(findings);
}

// ---- mapping ----------------------------------------------------------------------------------

export interface MappingState {
  indicators: {
    name: string;
    column: string | null;
    scale?: { min: number; max: number } | undefined;
    reverseScored?: boolean | undefined;
  }[];
  /** Data Lab reverse-scoring transformations (column → new column `as`) */
  transformations: {
    kind: string;
    column?: string;
    as?: string;
    scale?: { min: number; max: number };
  }[];
}

export function evaluateMapping(
  task: {
    expected: Record<string, string>;
    reverse: { indicator: string; min: number; max: number }[];
  },
  state: MappingState,
): TaskResult {
  const findings: Finding[] = [];
  const byName = new Map(state.indicators.map((i) => [norm(i.name), i]));
  const reversals = state.transformations.filter((t) => t.kind === 'reverse');
  for (const [indicator, column] of Object.entries(task.expected)) {
    const ind = byName.get(norm(indicator));
    if (!ind) {
      findings.push(f('missing', `There is no indicator named “${indicator}” in the model.`));
      continue;
    }
    const rev = task.reverse.find((r) => norm(r.indicator) === norm(indicator));
    if (ind.column === null) {
      findings.push(
        f('missing', `“${indicator}” is not mapped to a column yet (expected “${column}”).`),
      );
      continue;
    }
    const derived = reversals.find((t) => t.as === ind.column && t.column === column);
    if (ind.column !== column && !derived) {
      findings.push(
        f('wrong', `“${indicator}” is mapped to “${ind.column}” but should use “${column}”.`),
      );
      continue;
    }
    if (!rev) {
      findings.push(f('ok', `“${indicator}” is mapped to “${ind.column}”.`));
      continue;
    }
    const viaFlag =
      ind.reverseScored === true && ind.scale?.min === rev.min && ind.scale?.max === rev.max;
    const viaTransform = derived?.scale?.min === rev.min && derived?.scale?.max === rev.max;
    if (viaFlag || viaTransform) {
      findings.push(
        f(
          'ok',
          `“${indicator}” is mapped to “${column}” and reverse-scored on ${rev.min}–${rev.max}.`,
        ),
      );
    } else if (ind.reverseScored === true && ind.scale) {
      findings.push(
        f(
          'wrong',
          `“${indicator}” is reverse-scored with endpoints ${ind.scale.min}–${ind.scale.max}, but the instrument’s permitted endpoints are ${rev.min}–${rev.max}.`,
        ),
      );
    } else if (derived?.scale) {
      findings.push(
        f(
          'wrong',
          `The reverse transformation for “${indicator}” uses endpoints ${derived.scale.min}–${derived.scale.max}; use the permitted ${rev.min}–${rev.max}.`,
        ),
      );
    } else {
      findings.push(
        f('missing', `“${indicator}” must be reverse-scored (endpoints ${rev.min}–${rev.max}).`),
      );
    }
  }
  return finish(findings);
}

// ---- config -----------------------------------------------------------------------------------

type ConfigExpectation = Extract<Task, { kind: 'config' }>['expected'];

export function evaluateConfig(
  expected: ConfigExpectation,
  analysis: AnalysisConfiguration | null,
  problem: string | null,
  model?: SemModel,
): TaskResult {
  if (!analysis)
    return finish([
      f(
        'wrong',
        `The analysis settings are not valid yet${problem ? `: ${problem}` : '.'} Fix them on the Analysis page.`,
      ),
    ]);
  const findings: Finding[] = [];
  const check = (ok: boolean, good: string, bad: string): void => {
    findings.push(f(ok ? 'ok' : 'wrong', ok ? good : bad));
  };
  const methodName = { 'pls-sem': 'PLS-SEM', plsc: 'PLSc', 'cb-sem': 'CB-SEM' } as const;
  if (expected.method)
    check(
      analysis.method === expected.method,
      `Method is ${methodName[expected.method]}.`,
      `Method is ${methodName[analysis.method]}; this task needs ${methodName[expected.method]}.`,
    );
  if (expected.estimator)
    check(
      norm(analysis.estimator) === norm(expected.estimator),
      `Estimator is ${analysis.estimator}.`,
      `Estimator is ${analysis.estimator}; this task needs ${expected.estimator}.`,
    );
  if (expected.missingData)
    check(
      analysis.missingData === expected.missingData,
      `Missing data handling is ${analysis.missingData}.`,
      `Missing data handling is ${analysis.missingData}; this task needs ${expected.missingData}.`,
    );
  if (expected.bootstrapAtLeast !== undefined) {
    const b = analysis.bootstrap;
    const have = b?.enabled ? b.repetitions : 0;
    check(
      have >= expected.bootstrapAtLeast,
      `Bootstrap uses ${have} samples.`,
      b?.enabled
        ? `Bootstrap uses ${have} samples; this task needs at least ${expected.bootstrapAtLeast}.`
        : `Bootstrap is off; this task needs at least ${expected.bootstrapAtLeast} samples.`,
    );
  }
  if (expected.ipmaTarget) {
    const id = analysis.ipma?.targetConstructId;
    const construct = model?.constructs.find((c) => c.id === id);
    const want = norm(expected.ipmaTarget);
    check(
      id !== undefined &&
        (norm(id) === want || (construct !== undefined && norm(construct.name) === want)),
      `IPMA target is ${construct?.name ?? id ?? ''}.`,
      id
        ? `IPMA target is ${construct?.name ?? id}; this task needs ${expected.ipmaTarget}.`
        : `No IPMA target is chosen; this task needs ${expected.ipmaTarget}.`,
    );
  }
  return finish(findings);
}

// ---- self-assess ------------------------------------------------------------------------------

export function evaluateSelfAssess(
  checklist: readonly string[],
  ticked: readonly boolean[],
): TaskResult {
  const findings = checklist.map((item, i) =>
    ticked[i] === true ? f('ok', `Done: ${item}`) : f('missing', `Not yet ticked: ${item}`),
  );
  return finish(findings);
}

// ---- dispatcher -------------------------------------------------------------------------------

export interface TaskAnswer {
  choice?: readonly string[];
  number?: string;
  ticks?: readonly boolean[];
}

export interface EvalContext {
  model: SemModel;
  mapping: MappingState;
  analysis: AnalysisConfiguration | null;
  analysisProblem: string | null;
}

export function evaluateTask(task: Task, answer: TaskAnswer, ctx: EvalContext): TaskResult {
  switch (task.kind) {
    case 'choice':
      return evaluateChoice(task, answer.choice ?? []);
    case 'number':
      return evaluateNumber(task, answer.number ?? '');
    case 'model':
      return evaluateModel(task.check, ctx.model);
    case 'mapping':
      return evaluateMapping(task, ctx.mapping);
    case 'config':
      return evaluateConfig(task.expected, ctx.analysis, ctx.analysisProblem, ctx.model);
    case 'self-assess':
      return evaluateSelfAssess(task.checklist, answer.ticks ?? []);
  }
}

/** Tasks that are scored against the app's own state (usable while working on other pages). */
export const isWorkspaceTask = (t: Task): boolean =>
  t.kind === 'model' || t.kind === 'mapping' || t.kind === 'config';
