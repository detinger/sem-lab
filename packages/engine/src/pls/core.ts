/**
 * PLS-PM estimation core: the semantics of cSEM 0.7.1 `csem()` with the options the R engine
 * passes (services/r-engine/R/pls_estimate.R csem_options):
 *   .approach_weights = "PLS-PM", .approach_paths = "OLS", .conv_criterion = "diff_absolute",
 *   .PLS_weight_scheme_inner = path | centroid | factorial, .iter_max, .tolerance,
 *   .disattenuate = FALSE (classic) / TRUE with .PLS_approach_cf = "dist_squared_euclid" (PLSc),
 *   no .dominant_indicators (so no sign re-orientation), no .starting_values.
 *
 * Function by function this mirrors (re-implemented from the documented algorithm, not copied):
 *   cSEM:::calculateWeightsPLS      → fitWeights (starting weights = block indicator matrix,
 *                                     scaled; iterate inner → outer → scale until
 *                                     max|W_old − W_new| < tolerance)
 *   cSEM:::calculateInnerWeightsPLS → innerWeights (path / centroid / factorial)
 *   cSEM:::calculateOuterWeightsPLS → outer step (Mode A: proxy–indicator correlations;
 *                                     Mode B: S_jj⁻¹ × those correlations; single indicator: 1)
 *   cSEM:::scaleWeights             → scaleWeights (w'Sw = 1 per block)
 *   cSEM:::calculateReliabilities + calculateCorrectionFactors → loadings and Q (PLSc:
 *                                     λ = c·w, Q = c·w'w, c² = Σ_{i≠l} w_i w_l s_il / Σ_{i≠l} (w_i w_l)²)
 *   cSEM:::calculateCompositeVCV / calculateConstructVCV → C = WSW', P = C_ij/(Q_i Q_j)
 *   cSEM:::estimatePath (OLS, linear) → paths, R², adjusted R², VIF
 *   cSEM:::fit.cSEMResults_default  → modelImpliedIndicatorCor
 *   cSEM::verify                    → verify
 *
 * Everything is computed from the indicator correlation matrix S (cSEM standardises the data
 * and uses Pearson correlations), which is also what makes the bootstrap cheap.
 */
import {
  inverseR,
  isPositiveSemiDefinite,
  type Mat,
  NumericalError,
  solveR,
  sub,
  symmetrizeFromUpper,
  zeros,
} from '../linalg/index.ts';

export type InnerScheme = 'path' | 'centroid' | 'factorial';

/** The model as the estimation core sees it (indices, no ids). */
export interface CoreModel {
  /** number of constructs */
  k: number;
  /** number of indicators */
  p: number;
  /** indicator indices (0..p-1) of each construct's block, in block order */
  blocks: number[][];
  /** Mode B (composite-formative) blocks; all others are Mode A */
  modeB: boolean[];
  /** cSEM construct_type "Common factor" (reflective, `=~`); composites are `<~` */
  commonFactor: boolean[];
  /** structural[t][s] = 1 when there is a path s → t */
  structural: number[][];
  scheme: InnerScheme;
  maxIter: number;
  tol: number;
}

export interface CoreFit {
  converged: boolean;
  iterations: number;
  /** outer weights, k × p (zero outside the block), scaled so w'Sw = 1 */
  W: Mat;
  /** loadings, k × p (zero outside the block) */
  Lambda: Mat;
  /** square roots of the reliabilities (1 for composites and for classic PLS) */
  Q: number[];
  /** proxy (composite) correlations WSW' */
  C: Mat;
  /** construct correlations (PLSc: disattenuated) */
  P: Mat;
  /** path coefficients, B[t][s] for s → t */
  B: Mat;
  /** R² per construct (NaN for exogenous constructs) */
  R2: number[];
  R2adj: number[];
  /** structural VIF, vif[t][s] (NaN where not defined; cSEM leaves single predictors undefined) */
  vif: Mat;
  disattenuated: boolean;
}

/** Predecessors of each construct (sources of paths into it), in construct order. */
export function predecessors(model: CoreModel): number[][] {
  return model.structural.map((row) => row.map((v, s) => (v === 1 ? s : -1)).filter((s) => s >= 0));
}

/** W S restricted to the rows of W (k × p), exploiting the block sparsity of W. */
function weightsTimesS(S: Mat, W: Mat, blocks: number[][]): Mat {
  const p = S.length;
  return blocks.map((block, j) => {
    const out = new Array<number>(p).fill(0);
    const wj = W[j]!;
    for (const l of block) {
      const w = wj[l]!;
      if (w === 0) continue;
      const Sl = S[l]!;
      for (let i = 0; i < p; i++) out[i]! += w * Sl[i]!;
    }
    return out;
  });
}

/** C = W S W' with the upper triangle copied to the lower (cSEM calculateCompositeVCV). */
function compositeVcv(WS: Mat, W: Mat, blocks: number[][]): Mat {
  const k = blocks.length;
  const C = zeros(k, k);
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      let s = 0;
      const wj = W[j]!;
      const ri = WS[i]!;
      for (const l of blocks[j]!) s += ri[l]! * wj[l]!;
      C[i]![j] = s;
    }
  }
  symmetrizeFromUpper(C);
  return C;
}

/** cSEM:::scaleWeights: each row divided by the composite's standard deviation sqrt(w'Sw). */
export function scaleWeights(S: Mat, W: Mat, blocks: number[][]): Mat {
  return W.map((row, j) => {
    let v = 0;
    const block = blocks[j]!;
    for (const a of block) {
      const wa = row[a]!;
      if (wa === 0) continue;
      const Sa = S[a]!;
      for (const b of block) v += wa * Sa[b]! * row[b]!;
    }
    const f = 1 / Math.sqrt(v);
    if (!Number.isFinite(f)) throw new NumericalError('composite variance is not positive');
    return row.map((x) => x * f);
  });
}

/** cSEM:::calculateInnerWeightsPLS (with .PLS_ignore_structural_model = FALSE). */
function innerWeights(C: Mat, model: CoreModel, preds: number[][]): Mat {
  const { k, structural } = model;
  const E = zeros(k, k);
  if (model.scheme === 'path') {
    // successors get the correlation; predecessors the multiple-regression coefficients
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k; j++) if (structural[j]![i] === 1) E[i]![j] = C[i]![j]!;
    for (let j = 0; j < k; j++) {
      const f = preds[j]!;
      if (f.length === 0) continue;
      const coef = solveR(
        sub(C, f, f),
        f.map((s) => C[j]![s]!),
      );
      f.forEach((s, idx) => (E[j]![s] = coef[idx]!));
    }
    return E;
  }
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const adjacent = structural[i]![j] === 1 || structural[j]![i] === 1 ? 1 : 0;
      if (!adjacent) continue;
      const c = C[i]![j]!;
      E[i]![j] = model.scheme === 'centroid' ? Math.sign(c) : c;
    }
  }
  return E;
}

/** cSEM:::calculateOuterWeightsPLS for Mode A / Mode B blocks. */
function outerWeights(S: Mat, W: Mat, E: Mat, model: CoreModel): Mat {
  const { k, p, blocks } = model;
  const WS = weightsTimesS(S, W, blocks);
  // proxy–indicator correlations E (W S): only the own-block entries are needed
  const out = zeros(k, p);
  for (let j = 0; j < k; j++) {
    const block = blocks[j]!;
    const pic = block.map((a) => {
      let s = 0;
      const Ej = E[j]!;
      for (let m = 0; m < k; m++) {
        const e = Ej[m]!;
        if (e !== 0) s += e * WS[m]![a]!;
      }
      return s;
    });
    let w: number[];
    if (block.length === 1) w = [1];
    else if (model.modeB[j]) w = solveR(sub(S, block, block), pic);
    else w = pic;
    block.forEach((a, idx) => (out[j]![a] = w[idx]!));
  }
  return out;
}

export interface WeightResult {
  W: Mat;
  converged: boolean;
  iterations: number;
}

/** cSEM:::calculateWeightsPLS with .conv_criterion = "diff_absolute". */
export function fitWeights(S: Mat, model: CoreModel): WeightResult {
  const { k, p, blocks } = model;
  const preds = predecessors(model);
  let W = zeros(k, p);
  blocks.forEach((block, j) => block.forEach((a) => (W[j]![a] = 1)));
  W = scaleWeights(S, W, blocks);
  let Witer = W;
  let iter = 0;
  let converged = false;
  for (;;) {
    iter++;
    const C = compositeVcv(weightsTimesS(S, Witer, blocks), Witer, blocks);
    const E = innerWeights(C, model, preds);
    W = scaleWeights(S, outerWeights(S, Witer, E, model), blocks);
    let maxDiff = 0;
    for (let j = 0; j < k; j++) {
      const a = Witer[j]!;
      const b = W[j]!;
      for (let i = 0; i < p; i++) {
        const d = Math.abs(a[i]! - b[i]!);
        if (!(d <= maxDiff)) maxDiff = d;
      }
    }
    if (!Number.isFinite(maxDiff)) throw new NumericalError('non-finite weights');
    if (maxDiff < model.tol) {
      converged = true;
      break;
    }
    // iter_max == 1 gives cSEM status NULL, which the engine treats as not converged
    if (iter >= model.maxIter) break;
    Witer = W;
  }
  return { W, converged, iterations: iter };
}

/** cSEM:::calculateCorrectionFactors, .PLS_approach_cf = "dist_squared_euclid" (Mode A blocks). */
export function correctionFactor(S: Mat, w: readonly number[], block: readonly number[]): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < block.length; i++) {
    for (let l = 0; l < block.length; l++) {
      if (i === l) continue;
      const ww = w[i]! * w[l]!;
      num += ww * S[block[i]!]![block[l]!]!;
      den += ww * ww;
    }
  }
  return Math.sqrt(Math.abs(num / den));
}

/**
 * Loadings and Q (square roots of reliabilities) as cSEM:::calculateReliabilities:
 * classic: Λ = (WS) restricted to the blocks, Q = 1; PLSc: for every common factor with a
 * Mode A block of ≥ 2 indicators, λ = c·w and Q = c·Σw² (single indicators: λ = w, Q = w²).
 */
export function loadingsAndQ(
  S: Mat,
  W: Mat,
  model: CoreModel,
  disattenuate: boolean,
): { Lambda: Mat; Q: number[]; WS: Mat } {
  const { k, p, blocks } = model;
  const WS = weightsTimesS(S, W, blocks);
  const Lambda = zeros(k, p);
  const Q = new Array<number>(k).fill(1);
  for (let j = 0; j < k; j++) for (const a of blocks[j]!) Lambda[j]![a] = WS[j]![a]!;
  if (disattenuate) {
    for (let j = 0; j < k; j++) {
      if (!model.commonFactor[j] || model.modeB[j]) continue;
      const block = blocks[j]!;
      const w = block.map((a) => W[j]![a]!);
      const c = block.length === 1 ? 1 : correctionFactor(S, w, block);
      let q = 0;
      block.forEach((a, idx) => {
        const l = c * w[idx]!;
        Lambda[j]![a] = l;
        q += w[idx]! * l;
      });
      Q[j] = q;
    }
  }
  return { Lambda, Q, WS };
}

/** cSEM:::calculateConstructVCV. */
export function constructVcv(C: Mat, Q: readonly number[]): Mat {
  const k = C.length;
  const P = zeros(k, k);
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) P[i]![j] = i === j ? 1 : C[i]![j]! / (Q[i]! * Q[j]!);
  return P;
}

export interface PathResult {
  B: Mat;
  R2: number[];
  R2adj: number[];
  vif: Mat;
}

/** cSEM:::estimatePath for a linear model with OLS: coef = P_XX⁻¹ P_Xy per endogenous construct. */
export function estimatePaths(P: Mat, structural: number[][], n: number): PathResult {
  const k = P.length;
  const B = zeros(k, k);
  const R2 = new Array<number>(k).fill(NaN);
  const R2adj = new Array<number>(k).fill(NaN);
  const vif: Mat = Array.from({ length: k }, () => new Array<number>(k).fill(NaN));
  for (let y = 0; y < k; y++) {
    const X: number[] = [];
    for (let s = 0; s < k; s++) if (structural[y]![s] === 1) X.push(s);
    if (X.length === 0) continue;
    const Pxx = sub(P, X, X);
    const inv = inverseR(Pxx);
    const pxy = X.map((s) => P[s]![y]!);
    const coef = inv.map((row) => row.reduce((acc, v, i) => acc + v * pxy[i]!, 0));
    let r2 = 0;
    for (let a = 0; a < X.length; a++)
      for (let b = 0; b < X.length; b++) r2 += coef[a]! * Pxx[a]![b]! * coef[b]!;
    X.forEach((s, i) => (B[y]![s] = coef[i]!));
    R2[y] = r2;
    R2adj[y] = 1 - ((1 - r2) * (n - 1)) / (n - X.length - 1);
    if (X.length > 1) X.forEach((s, i) => (vif[y]![s] = inv[i]![i]!));
  }
  return { B, R2, R2adj, vif };
}

/** The complete csem() fit on a correlation matrix. Throws NumericalError where cSEM errors. */
export function fitPls(S: Mat, model: CoreModel, disattenuate: boolean, n: number): CoreFit {
  const wr = fitWeights(S, model);
  return completeFit(S, model, wr, disattenuate, n);
}

/** Everything after the weights (so a PLSc pass can reuse classic weights: they are identical). */
export function completeFit(
  S: Mat,
  model: CoreModel,
  wr: WeightResult,
  disattenuate: boolean,
  n: number,
): CoreFit {
  const { W } = wr;
  const { Lambda, Q, WS } = loadingsAndQ(S, W, model, disattenuate);
  const C = compositeVcv(WS, W, model.blocks);
  const P = constructVcv(C, Q);
  const { B, R2, R2adj, vif } = estimatePaths(P, model.structural, n);
  return {
    converged: wr.converged,
    iterations: wr.iterations,
    W,
    Lambda,
    Q,
    C,
    P,
    B,
    R2,
    R2adj,
    vif,
    disattenuated: disattenuate,
  };
}

/**
 * Model-implied construct correlations of cSEM:::fit(.saturated = FALSE): exogenous block Φ
 * from P, endogenous from the structural equations, ζ variances 1 − Σ_s b_ts p_ts.
 */
export function modelImpliedConstructCor(fit: CoreFit, model: CoreModel): Mat {
  const k = model.k;
  const endo: number[] = [];
  const exo: number[] = [];
  for (let c = 0; c < k; c++) (model.structural[c]!.some((v) => v === 1) ? endo : exo).push(c);
  const { B: Path, P } = fit;
  const ne = endo.length;
  const IminusB = endo.map((t, a) => endo.map((s, b) => (a === b ? 1 : 0) - Path[t]![s]!));
  const IB = inverseR(IminusB);
  const Gamma = endo.map((t) => exo.map((s) => Path[t]![s]!));
  const Phi = sub(P, exo, exo);
  const zeta = endo.map((t) => {
    let s = 0;
    for (let c = 0; c < k; c++) s += Path[t]![c]! * P[t]![c]!;
    return 1 - s;
  });
  // Corr_exo_endo = Φ Γ' IB'
  const PhiGt = Phi.map((row) =>
    endo.map((_, a) => row.reduce((acc, v, s) => acc + v * Gamma[a]![s]!, 0)),
  );
  const corrExoEndo = PhiGt.map((row) =>
    endo.map((_, b) => row.reduce((acc, v, a) => acc + v * IB[b]![a]!, 0)),
  );
  // Cor_endo = IB (Γ Φ Γ' + Ψ) IB'
  const inner = Gamma.map((ga, a) =>
    endo.map((_, b) => {
      let s = 0;
      for (let i = 0; i < exo.length; i++) s += ga[i]! * PhiGt[i]![b]!;
      return s + (a === b ? zeta[a]! : 0);
    }),
  );
  const tmp = IB.map((row) =>
    endo.map((_, b) => row.reduce((acc, v, a) => acc + v * inner[a]![b]!, 0)),
  );
  const corEndo = tmp.map((row) =>
    endo.map((_, b) => row.reduce((acc, v, a) => acc + v * IB[b]![a]!, 0)),
  );
  for (let a = 0; a < ne; a++) corEndo[a]![a] = 1;
  // assemble in cSEM's exo-then-endo order, symmetrise from the upper triangle, map back
  const order = [...exo, ...endo];
  const V0 = zeros(k, k);
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) {
      let v: number;
      if (a < exo.length && b < exo.length) v = Phi[a]![b]!;
      else if (a < exo.length) v = corrExoEndo[a]![b - exo.length]!;
      else if (b < exo.length) v = corrExoEndo[b]![a - exo.length]!;
      else v = corEndo[a - exo.length]![b - exo.length]!;
      V0[a]![b] = v;
    }
  }
  symmetrizeFromUpper(V0);
  const V = zeros(k, k);
  for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) V[order[a]!]![order[b]!] = V0[a]![b]!;
  return V;
}

/**
 * Model-implied indicator correlation matrix of cSEM:::fit(.type_vcv = "indicator",
 * .saturated = FALSE): Σ = Λ'VΛ + Θ, Θ = diag(1 − λ²), within-block entries of composites
 * replaced by the empirical S. `treatAsCommonFactor` reproduces calculateRhoC's temporary
 * conversion of composites to common factors.
 */
export function modelImpliedIndicatorCor(
  S: Mat,
  fit: CoreFit,
  model: CoreModel,
  treatAsCommonFactor = false,
): Mat {
  const V = modelImpliedConstructCor(fit, model);
  const { p, k, blocks } = model;
  const owner = new Array<number>(p).fill(-1);
  blocks.forEach((b, j) => b.forEach((a) => (owner[a] = j)));
  const lam = new Array<number>(p).fill(0);
  for (let a = 0; a < p; a++) {
    let s = 0;
    for (let j = 0; j < k; j++) s += fit.Lambda[j]![a]! ** 2;
    lam[a] = s; // diag(Λ'Λ)
  }
  const Sigma = zeros(p, p);
  for (let a = 0; a < p; a++) {
    for (let b = a; b < p; b++) {
      const ja = owner[a]!;
      const jb = owner[b]!;
      let v = fit.Lambda[ja]![a]! * V[ja]![jb]! * fit.Lambda[jb]![b]!;
      if (a === b) v += S[a]![a]! - lam[a]!;
      Sigma[a]![b] = v;
    }
  }
  symmetrizeFromUpper(Sigma);
  if (!treatAsCommonFactor) {
    blocks.forEach((block, j) => {
      if (model.commonFactor[j]) return;
      for (const a of block) for (const b of block) Sigma[a]![b] = S[a]![b]!;
    });
  }
  return Sigma;
}

export const VERIFY_CHECKS: Readonly<Record<'1' | '2' | '3' | '4' | '5', string>> = {
  '1': 'Convergence achieved',
  '2': 'All absolute standardized loading estimates <= 1',
  '3': 'Construct VCV is positive semi-definite',
  '4': 'All reliability estimates <= 1',
  '5': 'Model-implied indicator VCV is positive semi-definite',
};
export type VerifyCheck = keyof typeof VERIFY_CHECKS;

/** cSEM::verify(): the checks that FAILED. */
export function verify(S: Mat, fit: CoreFit, model: CoreModel): VerifyCheck[] {
  const failed: VerifyCheck[] = [];
  if (!fit.converged) failed.push('1');
  let maxAbs = 0;
  for (const row of fit.Lambda)
    for (const v of row) if (!(Math.abs(v) <= maxAbs)) maxAbs = Math.abs(v);
  if (maxAbs > 1 || Number.isNaN(maxAbs)) failed.push('2');
  if (!isPositiveSemiDefinite(fit.P)) failed.push('3');
  if (fit.Q.some((q) => !(q * q <= 1))) failed.push('4');
  let sigmaPsd: boolean;
  try {
    sigmaPsd = isPositiveSemiDefinite(modelImpliedIndicatorCor(S, fit, model));
  } catch {
    sigmaPsd = false;
  }
  if (!sigmaPsd) failed.push('5');
  return failed;
}
