/**
 * Request and data validation for the browser PLS engine: the checks, error codes and
 * reasons of services/r-engine/R/job_validate.R (validate_request, validate_ipma,
 * load_job_data), applied to the in-memory analysis matrix the web app builds
 * (apps/web/src/domain/dataset/analysis-data.ts: indicator columns in model order, reverse
 * scoring min + max − x ALREADY applied, listwise-complete rows).
 *
 * The capability registry is not consulted here: the application gates options by the
 * registry before it calls the engine; the engine refuses only what it cannot compute.
 */
import type { AnalysisConfiguration, ResultWarning, SemModel } from '@sem-studio/contracts';
import { correlation, qrRank } from '../linalg/index.ts';
import { EngineError, invalid } from '../shared/errors.ts';
import type { CoreModel, InnerScheme } from './core.ts';
import { allPaths, findCycle, type PathEdge } from './effects.ts';

export const ENGINE_ID = 'browser';
const ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/;

export interface AnalysisDataInput {
  /** bound data column names of the matrix, one per column */
  columns: string[];
  /** listwise-complete numeric rows (reverse scoring already applied) */
  rows: number[][];
  /** working rows before missing-data handling */
  nRows: number;
  /** rows removed by listwise deletion before the engine was called */
  nDropped: number;
}

export interface SpecConstruct {
  id: string;
  reflective: boolean;
  modeB: boolean;
  indicatorIds: string[];
  /** positions of the block's indicators in `PlsSpec.indicatorIds` */
  indicators: number[];
}

export interface SpecIndicator {
  id: string;
  column: string;
  reverse: boolean;
  scale: { min: number; max: number } | null;
}

export interface SpecPath extends PathEdge {
  id: string;
}

export interface BootstrapSpec {
  reps: number;
  level: number;
  sides: 'two-sided' | 'one-sided';
  seed: number;
}

export interface IpmaSpec {
  target: number;
  predecessors: number[];
  direct: boolean[];
}

export interface PlsSpec {
  method: 'pls-sem' | 'plsc';
  scheme: InnerScheme;
  maxIter: number;
  tol: number;
  constructs: SpecConstruct[];
  /** model indicator order: block by block in `indicatorIds` order */
  indicators: SpecIndicator[];
  paths: SpecPath[];
  bootstrap: BootstrapSpec | null;
  ipma: IpmaSpec | null;
  warnings: ResultWarning[];
}

function isWhole(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && Math.abs(x - Math.round(x)) < 1e-9;
}

function checkId(x: unknown, what: string): string {
  if (typeof x !== 'string' || x.length > 128 || !ID_PATTERN.test(x)) {
    throw invalid(`${what} must be an id matching ${ID_PATTERN.source} (max 128 characters).`);
  }
  return x;
}

/** validate_request(): model + analysis → spec, or a stable EngineError. */
export function validateRequest(model: SemModel, an: AnalysisConfiguration): PlsSpec {
  if (an.engine !== ENGINE_ID) {
    throw invalid(
      `This is the ${ENGINE_ID} engine; the request asks for engine \`${String(an.engine)}\`.`,
    );
  }
  const method = an.method;
  if (method === 'cb-sem') {
    throw new EngineError(
      'CAPABILITY_UNSUPPORTED',
      'CB-SEM is not estimated by the PLS engine (use the CB-SEM entry point).',
      {
        method,
        engine: ENGINE_ID,
      },
    );
  }
  if (method !== 'pls-sem' && method !== 'plsc')
    throw invalid('analysis.method must be `pls-sem` or `plsc`.');
  if (an.estimator !== 'pls-pm') {
    throw new EngineError(
      'CAPABILITY_UNSUPPORTED',
      'The browser PLS engine implements estimator `pls-pm` only.',
      {
        engine: ENGINE_ID,
      },
    );
  }
  if (an.missingData !== 'listwise') {
    throw invalid(
      'analysis.missingData must be `listwise` for PLS methods (FIML is defined for CB-SEM only).',
    );
  }
  if (an.cb !== undefined) throw invalid('analysis.cb is only valid for CB-SEM.');
  if (an.ipma !== undefined && method !== 'pls-sem') {
    throw new EngineError(
      'CAPABILITY_UNSUPPORTED',
      'IPMA uses a classic PLS-SEM fit (method `pls-sem`); it is not computed from a PLSc fit (in Phase 0 a PLSc fit shifted importance by 0.086).',
      { capabilityId: 'ipma.construct', method },
    );
  }
  const pls = an.pls;
  if (!pls)
    throw invalid(
      'analysis.pls (innerWeighting, maxIterations, tolerance) is required for PLS methods.',
    );
  const scheme = pls.innerWeighting;
  if (!['path', 'centroid', 'factorial'].includes(scheme)) {
    throw invalid('analysis.pls.innerWeighting must be `path`, `centroid` or `factorial`.');
  }
  if (!isWhole(pls.maxIterations) || pls.maxIterations < 1 || pls.maxIterations > 100000) {
    throw invalid('analysis.pls.maxIterations must be an integer in [1, 100000].');
  }
  if (
    !(typeof pls.tolerance === 'number' && Number.isFinite(pls.tolerance)) ||
    pls.tolerance <= 0 ||
    pls.tolerance > 0.01
  ) {
    throw invalid('analysis.pls.tolerance must be a number in (0, 0.01].');
  }

  let bootstrap: BootstrapSpec | null = null;
  if (an.bootstrap?.enabled === true) {
    const b = an.bootstrap;
    if (b.ci === 'bca') {
      throw new EngineError(
        'CAPABILITY_UNSUPPORTED',
        'Bootstrap `bca` intervals are not available in the browser engine (only percentile intervals are verified).',
        { capabilityId: 'resampling.bootstrap-bca', engine: ENGINE_ID },
      );
    }
    if (b.ci !== 'percentile')
      throw invalid('analysis.bootstrap.ci must be `percentile` or `bca`.');
    if (!isWhole(b.repetitions) || b.repetitions < 1 || b.repetitions > 100000) {
      throw invalid('analysis.bootstrap.repetitions must be an integer in [1, 100000].');
    }
    if (!(b.confidenceLevel > 0.5 && b.confidenceLevel < 1)) {
      throw invalid('analysis.bootstrap.confidenceLevel must lie strictly between 0.5 and 1.');
    }
    if (b.sides !== 'two-sided' && b.sides !== 'one-sided') {
      throw invalid('analysis.bootstrap.sides must be `two-sided` or `one-sided`.');
    }
    if (!isWhole(an.seed) || an.seed < 0 || an.seed > 2147483647) {
      throw invalid('analysis.seed (integer in [0, 2147483647]) is required when bootstrapping.');
    }
    bootstrap = { reps: b.repetitions, level: b.confidenceLevel, sides: b.sides, seed: an.seed };
  }

  // ---- model --------------------------------------------------------------------------
  if (!Array.isArray(model.constructs) || model.constructs.length === 0) {
    throw invalid('model.constructs must be a non-empty array.');
  }
  const indById = new Map<string, SemModel['indicators'][number]>();
  for (const i of model.indicators) {
    const id = checkId(i.id, 'indicator id');
    if (indById.has(id)) throw invalid(`Duplicate indicator id \`${id}\`.`);
    if (
      i.scale &&
      !(Number.isFinite(i.scale.min) && Number.isFinite(i.scale.max) && i.scale.min < i.scale.max)
    ) {
      throw invalid(`Indicator \`${id}\`: scale needs numeric min < max.`);
    }
    indById.set(id, i);
  }
  const constructs: SpecConstruct[] = [];
  const indicators: SpecIndicator[] = [];
  const usedInds = new Set<string>();
  const consIndex = new Map<string, number>();
  for (const cc of model.constructs) {
    const id = checkId(cc.id, 'construct id');
    if (consIndex.has(id) || indById.has(id)) throw invalid(`Duplicate id \`${id}\`.`);
    if (cc.measurement !== 'reflective' && cc.measurement !== 'composite-formative') {
      throw invalid(
        `Construct \`${id}\`: measurement must be \`reflective\` or \`composite-formative\`.`,
      );
    }
    if (cc.higherOrder !== undefined) {
      throw new EngineError(
        'CAPABILITY_UNSUPPORTED',
        'Higher-order constructs are not available in the browser PLS engine.',
        {
          capabilityId: 'pls.higher-order',
          engine: ENGINE_ID,
          constructId: id,
        },
      );
    }
    const ids = cc.indicatorIds;
    if (ids.length === 0)
      throw invalid(`Construct \`${id}\` has no indicators.`, { constructId: id });
    for (const ii of ids)
      if (!indById.has(ii)) throw invalid(`Construct \`${id}\` lists unknown indicator \`${ii}\`.`);
    if (new Set(ids).size !== ids.length)
      throw invalid(`Construct \`${id}\` lists an indicator twice.`);
    const dup = ids.filter((ii) => usedInds.has(ii));
    if (dup.length > 0) {
      throw invalid(`Indicator \`${dup[0]!}\` is assigned to more than one construct.`, {
        indicatorIds: dup,
      });
    }
    const defaultMode = cc.measurement === 'reflective' ? 'mode-a' : 'mode-b';
    const mode = cc.plsWeightingMode ?? defaultMode;
    if (mode !== defaultMode) {
      throw new EngineError(
        'CAPABILITY_UNSUPPORTED',
        `Construct \`${id}\`: overriding the weighting mode of a ${cc.measurement} block (${mode}) is not offered; the mode follows the measurement kind.`,
        { constructId: id },
      );
    }
    const positions: number[] = [];
    for (const ii of ids) {
      usedInds.add(ii);
      const ind = indById.get(ii)!;
      positions.push(indicators.length);
      indicators.push({
        id: ii,
        column: ind.column ?? '',
        reverse: ind.reverseScored === true,
        scale: ind.scale ? { min: ind.scale.min, max: ind.scale.max } : null,
      });
      if (ind.column === null) {
        throw invalid(`Indicator \`${ii}\` is not mapped to a data column.`, {
          indicatorIds: [ii],
        });
      }
      if (ind.reverseScored === true && !ind.scale) {
        throw invalid(`Indicator \`${ii}\` is reverse scored but has no scale endpoints.`, {
          indicatorIds: [ii],
        });
      }
    }
    consIndex.set(id, constructs.length);
    constructs.push({
      id,
      reflective: cc.measurement === 'reflective',
      modeB: mode === 'mode-b',
      indicatorIds: [...ids],
      indicators: positions,
    });
  }
  const cols = indicators.map((i) => i.column);
  const dupCols = [...new Set(cols.filter((c, i) => cols.indexOf(c) !== i))];
  if (dupCols.length > 0)
    throw invalid('A data column is bound to more than one indicator.', { columns: dupCols });

  // ---- relationships --------------------------------------------------------------------
  const relIds = new Set<string>();
  const paths: SpecPath[] = [];
  for (const r of model.relationships) {
    const rid = checkId(r.id, 'relationship id');
    if (relIds.has(rid)) throw invalid(`Duplicate relationship id \`${rid}\`.`);
    relIds.add(rid);
    if (r.kind !== 'structural') continue;
    const s = consIndex.get(r.sourceId);
    const t = consIndex.get(r.targetId);
    if (s === undefined || t === undefined)
      throw invalid(`Structural relationship \`${rid}\` must connect two constructs.`);
    if (s === t) throw invalid(`Structural relationship \`${rid}\` is a self-loop.`);
    if (paths.some((p) => p.source === s && p.target === t)) {
      throw invalid(`Structural path ${r.sourceId} -> ${r.targetId} is listed twice.`);
    }
    if (r.fixedValue !== undefined) {
      throw new EngineError(
        'CAPABILITY_UNSUPPORTED',
        `Relationship \`${rid}\`: fixed path values are not supported in PLS-SEM.`,
        {
          relationshipId: rid,
        },
      );
    }
    paths.push({ id: rid, source: s, target: t });
  }
  const targets = new Set(paths.map((p) => p.target));
  const warnings: ResultWarning[] = [];
  for (const r of model.relationships) {
    if (r.kind !== 'covariance') continue;
    const s = consIndex.get(r.sourceId);
    const t = consIndex.get(r.targetId);
    if (s !== undefined && t !== undefined && s !== t && !targets.has(s) && !targets.has(t)) {
      warnings.push({
        code: 'EXOGENOUS_CORRELATION_IMPLIED',
        severity: 'info',
        message:
          'PLS-SEM leaves the correlation between exogenous constructs free; this covariance relationship is not a separate parameter. The estimate is in the construct-correlations matrix.',
        elementIds: [...new Set([r.id, r.sourceId, r.targetId])],
      });
    } else {
      throw new EngineError(
        'CAPABILITY_UNSUPPORTED',
        `Covariance relationship \`${r.id}\`: PLS-SEM does not estimate indicator residual covariances or covariances involving endogenous constructs.`,
        { relationshipId: r.id },
      );
    }
  }
  if (paths.length === 0) {
    throw new EngineError(
      'MODEL_NOT_IDENTIFIED',
      'A PLS path model needs at least one structural path.',
      {},
    );
  }
  const isolated = constructs
    .map((c, i) => (paths.some((p) => p.source === i || p.target === i) ? null : c.id))
    .filter((x): x is string => x !== null);
  if (isolated.length > 0) {
    throw new EngineError(
      'MODEL_NOT_IDENTIFIED',
      'Every construct must take part in at least one structural path (the PLS inner weighting has no neighbour for an isolated construct).',
      { constructIds: isolated },
    );
  }
  const k = constructs.length;
  const cyc = findCycle(k, paths);
  if (cyc) {
    const ids = cyc.map((i) => constructs[i]!.id);
    throw invalid(
      `The structural model contains a cycle (${ids.join(' -> ')}). The PLS engine estimates recursive models only.`,
      { constructIds: [...new Set(ids)] },
    );
  }

  let ipma: IpmaSpec | null = null;
  if (an.ipma !== undefined) {
    const target = consIndex.get(an.ipma.targetConstructId);
    if (target === undefined) {
      throw invalid('analysis.ipma.targetConstructId is not a construct of the model.', {
        reason: 'ipma-target-unknown',
      });
    }
    const preds: number[] = [];
    for (let c = 0; c < k; c++)
      if (c !== target && allPaths(k, paths, c, target, 1).length > 0) preds.push(c);
    if (preds.length === 0) {
      throw invalid(
        `The IPMA target \`${constructs[target]!.id}\` has no predecessor construct (no structural path leads to it).`,
        { reason: 'ipma-no-predecessors', constructIds: [constructs[target]!.id] },
      );
    }
    const noScale = indicators.filter((i) => i.scale === null).map((i) => i.id);
    if (noScale.length > 0) {
      throw invalid(
        `IPMA needs the original scale endpoints (scale.min, scale.max) of every model indicator; ${noScale.length} indicator(s) have none.`,
        { reason: 'ipma-scale-missing', indicatorIds: noScale },
      );
    }
    ipma = {
      target,
      predecessors: preds,
      direct: preds.map((c) => paths.some((p) => p.source === c && p.target === target)),
    };
  }

  return {
    method,
    scheme,
    maxIter: pls.maxIterations,
    tol: pls.tolerance,
    constructs,
    indicators,
    paths,
    bootstrap,
    ipma,
    warnings,
  };
}

export interface PreparedData {
  /** analysis matrix in model indicator order, column-major */
  columns: Float64Array[];
  n: number;
  nRows: number;
  nDropped: number;
  reversed: string[];
}

/** load_job_data(): the numeric matrix in model indicator order, with the R engine's checks. */
export function prepareData(spec: PlsSpec, data: AnalysisDataInput): PreparedData {
  const rows = data.rows;
  if (!Array.isArray(rows) || !Array.isArray(data.columns))
    throw invalid('data needs `columns` and `rows`.');
  if (
    !(Number.isInteger(data.nRows) && Number.isInteger(data.nDropped)) ||
    data.nRows < 0 ||
    data.nDropped < 0 ||
    data.nRows - data.nDropped !== rows.length
  ) {
    throw invalid(
      'The data preparation is inconsistent (nRows - nDropped must equal the number of rows passed).',
      { reason: 'data-preparation-mismatch', uploadedRows: rows.length },
    );
  }
  const hdr = data.columns;
  const missingCols = spec.indicators.filter((i) => !hdr.includes(i.column));
  if (missingCols.length > 0) {
    throw new EngineError(
      'DATA_COLUMN_MISSING',
      `${missingCols.length} mapped column(s) are not in the data: ${missingCols.map((i) => `\`${i.column}\``).join(', ')}.`,
      { columns: missingCols.map((i) => i.column), indicatorIds: missingCols.map((i) => i.id) },
    );
  }
  const ambiguous = spec.indicators.filter(
    (i) => hdr.indexOf(i.column) !== hdr.lastIndexOf(i.column),
  );
  if (ambiguous.length > 0) {
    throw invalid('A mapped column name occurs more than once in the data header.', {
      columns: ambiguous.map((i) => i.column),
    });
  }
  const n = rows.length;
  const p = spec.indicators.length;
  const columns = spec.indicators.map(() => new Float64Array(n));
  const colIdx = spec.indicators.map((i) => hdr.indexOf(i.column));
  const nonNumeric = new Map<string, number>();
  const missing = new Map<string, number>();
  for (let r = 0; r < n; r++) {
    const row = rows[r];
    for (let j = 0; j < p; j++) {
      const v: unknown = row?.[colIdx[j]!];
      const col = spec.indicators[j]!.column;
      if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) {
        missing.set(col, (missing.get(col) ?? 0) + 1);
      } else if (typeof v !== 'number' || !Number.isFinite(v)) {
        nonNumeric.set(col, (nonNumeric.get(col) ?? 0) + 1);
      } else columns[j]![r] = v;
    }
  }
  if (nonNumeric.size > 0) {
    throw new EngineError(
      'DATA_NOT_NUMERIC',
      `${nonNumeric.size} mapped column(s) contain non-numeric cells: ${[...nonNumeric].map(([c, k]) => `\`${c}\` (${k} cells)`).join(', ')}.`,
      { columns: [...nonNumeric.keys()], nonNumericCells: [...nonNumeric.values()] },
    );
  }
  if (missing.size > 0) {
    throw invalid(
      `${missing.size} mapped column(s) contain missing cells: ${[...missing].map(([c, k]) => `\`${c}\` (${k} cells)`).join(', ')}. The engine expects the listwise-complete data set.`,
      {
        reason: 'missing-values',
        columns: [...missing.keys()],
        missingCells: [...missing.values()],
      },
    );
  }
  if (n < 3) {
    throw new EngineError(
      'DATA_INSUFFICIENT_ROWS',
      `The data have ${n} row(s); at least 3 are required.`,
      {
        nRows: n,
        minimum: 3,
      },
    );
  }
  const constant = spec.indicators.filter((_, j) => columns[j]!.every((x) => x === columns[j]![0]));
  if (constant.length > 0) {
    throw new EngineError(
      'DATA_ZERO_VARIANCE',
      `${constant.length} mapped column(s) have zero variance: ${constant.map((i) => `\`${i.column}\``).join(', ')}.`,
      { columns: constant.map((i) => i.column), indicatorIds: constant.map((i) => i.id) },
    );
  }
  if (spec.ipma) {
    // reverse scoring maps [min, max] onto itself, so checking the reversed values is equivalent
    const bad: string[] = [];
    const counts: number[] = [];
    spec.indicators.forEach((ind, j) => {
      const { min, max } = ind.scale!;
      let c = 0;
      for (const x of columns[j]!) if (x < min || x > max) c++;
      if (c > 0) {
        bad.push(ind.id);
        counts.push(c);
      }
    });
    if (bad.length > 0) {
      throw invalid(
        `IPMA: ${bad.length} indicator(s) have observed values outside their declared scale endpoints.`,
        { reason: 'ipma-out-of-scale', indicatorIds: bad, cellsOutOfScale: counts },
      );
    }
  }
  for (const c of spec.constructs) {
    if (!c.modeB || c.indicators.length < 2) continue;
    const R = correlation(c.indicators.map((j) => columns[j]!)).S;
    if (qrRank(R, 1e-10) < R.length) {
      throw new EngineError(
        'MODEL_NOT_IDENTIFIED',
        `The indicators of Mode B construct \`${c.id}\` are perfectly collinear; its weights are not identified.`,
        { constructId: c.id },
      );
    }
  }
  return {
    columns,
    n,
    nRows: data.nRows,
    nDropped: data.nDropped,
    reversed: spec.indicators.filter((i) => i.reverse).map((i) => i.id),
  };
}

/** The estimation core's view of the spec. */
export function coreModel(spec: PlsSpec): CoreModel {
  const k = spec.constructs.length;
  const structural = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (const p of spec.paths) structural[p.target]![p.source] = 1;
  return {
    k,
    p: spec.indicators.length,
    blocks: spec.constructs.map((c) => c.indicators),
    modeB: spec.constructs.map((c) => c.modeB),
    commonFactor: spec.constructs.map((c) => c.reflective),
    structural,
    scheme: spec.scheme,
    maxIter: spec.maxIter,
    tol: spec.tol,
  };
}
