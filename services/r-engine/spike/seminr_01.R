# Phase 0 spike - seminr: PLS, PLSc, bootstrap, summary(), predict_pls, CB-SEM,
# and the PLS cross-checks against cSEM (task items 6 and 8).
#
# Cross-checks run in this script (max absolute differences are recorded):
#   - seminr composite(Mode A) + path_weighting   vs cSEM '=~' .disattenuate = FALSE, path scheme
#   - seminr composite(Mode A) + path_factorial   vs cSEM factorial scheme
#   - seminr reflective() (PLSc applied automatically) vs cSEM PLSc
#   - seminr summary() reliability / HTMT / FL / cross-loadings / f2 / VIF vs cSEM assess()
#     (cSEM's numbers were verified against textbook formulas in csem_assess.json)
#   - seminr bootstrap draws vs own percentile intervals
#   - seminr estimate_cbsem / estimate_cfa vs lavaan::sem / cfa on the same model and estimator
#
# Evidence: docs/validation/phase-0/evidence/r/seminr.json
#           docs/validation/phase-0/evidence/r/parity_seminr_pls-path.json

source(file.path(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "_common.R"))
suppressPackageStartupMessages({ library(seminr); library(cSEM); library(lavaan) })

d <- load_tam()
n <- nrow(d)
cons <- names(TAM_BLOCKS)
ind_all <- unlist(TAM_BLOCKS, use.names = FALSE)
find <- list()
quiet <- function(expr) { v <- NULL; utils::capture.output(v <- suppressMessages(expr)); v }

mm_comp <- do.call(constructs, lapply(cons, function(k) composite(k, TAM_BLOCKS[[k]], weights = mode_A)))
mm_refl <- do.call(constructs, lapply(cons, function(k) reflective(k, TAM_BLOCKS[[k]])))
sm <- do.call(relationships, lapply(names(TAM_STRUCT), function(to) paths(from = TAM_STRUCT[[to]], to = to)))

# seminr matrices: path_coef[from, to]; outer_loadings / outer_weights [indicator, construct]; rSquared["Rsq", endo]
sem_paths <- function(r) mapply(function(f, t) r$path_coef[f, t], TAM_PATHS$from, TAM_PATHS$to)
sem_block <- function(M) unlist(lapply(cons, function(k) M[TAM_BLOCKS[[k]], k]))
sem_r2 <- function(r) r$rSquared["Rsq", names(TAM_STRUCT)]
csem_block <- function(M) csem_block_df(M)$est
cmp_csem <- function(r, cs) list(
  paths = max_abs_diff(sem_paths(r), csem_paths_df(cs)$est),
  loadings = max_abs_diff(sem_block(r$outer_loadings), csem_block(cs$Estimates$Loading_estimates)),
  weights = max_abs_diff(sem_block(r$outer_weights), csem_block(cs$Estimates$Weight_estimates)),
  r2 = max_abs_diff(sem_r2(r), cs$Estimates$R2[names(TAM_STRUCT)]),
  construct_scores = max_abs_diff(r$construct_scores[, cons], cs$Estimates$Construct_scores[, cons])
)

find$api <- list(
  versions = list(seminr = pkg_ver("seminr"), cSEM = pkg_ver("cSEM"), lavaan = pkg_ver("lavaan")),
  estimate_pls = formals_of(estimate_pls), bootstrap_model = formals_of(bootstrap_model),
  PLSc = formals_of(PLSc), predict_pls = formals_of(predict_pls),
  estimate_cbsem = formals_of(estimate_cbsem), estimate_cfa = formals_of(estimate_cfa),
  composite = formals_of(composite), reflective = formals_of(reflective),
  inner_weight_functions_exported = c("path_weighting", "path_factorial"),
  centroid_scheme_available = exists("path_centroid", asNamespace("seminr")),
  stopCriterion_meaning = "convergence when the weight change is below 10^-stopCriterion (default 7)"
)

# ---- 1. classic PLS Mode A: path weighting and factorial ------------------------------------------
TOL_EXP <- 12
pls_path <- try_capture(quiet(estimate_pls(d, mm_comp, sm, inner_weights = path_weighting, stopCriterion = TOL_EXP)))
pls_fact <- try_capture(quiet(estimate_pls(d, mm_comp, sm, inner_weights = path_factorial, stopCriterion = TOL_EXP)))
cs_path <- csem(d, tam_model_syntax("=~"), .disattenuate = FALSE, .PLS_weight_scheme_inner = "path", .tolerance = 1e-12, .iter_max = 500)
cs_fact <- csem(d, tam_model_syntax("=~"), .disattenuate = FALSE, .PLS_weight_scheme_inner = "factorial", .tolerance = 1e-12, .iter_max = 500)
pls_default <- quiet(estimate_pls(d, mm_comp, sm))
find$pls_classic <- list(
  model = "composite(k, items, weights = mode_A) for every construct; relationships(paths(...))",
  path_weighting = status_of(pls_path, function(v) list(iterations = v$iterations, max_abs_diff_vs_cSEM_classic_path = cmp_csem(v, cs_path))),
  factorial = status_of(pls_fact, function(v) list(iterations = v$iterations, max_abs_diff_vs_cSEM_classic_factorial = cmp_csem(v, cs_fact))),
  `default_stopCriterion_7_vs_cSEM_tol_1e-12` = cmp_csem(pls_default, cs_path),
  weight_scaling_seminr = "outer weights scaled so each construct score has unit variance (sd with n - 1)",
  composite_variance_check = max(abs(apply(pls_path$value$construct_scores, 2, stats::sd) - 1))
)
r_path <- pls_path$value

# ---- 2. PLSc --------------------------------------------------------------------------------------
cs_plsc <- csem(d, tam_model_syntax("=~"), .tolerance = 1e-12, .iter_max = 500)
refl <- try_capture(quiet(estimate_pls(d, mm_refl, sm, stopCriterion = TOL_EXP)))
plsc_fn_on_comp <- try_capture(quiet(PLSc(r_path)))
plsc_fn_on_refl <- if (refl$ok) try_capture(quiet(PLSc(refl$value))) else NULL
find$plsc <- list(
  how = "reflective(k, items) constructs are estimated with PLSc automatically by estimate_pls() (mmMatrix type 'C'); PLSc() is applied inside estimate_pls via model_consistent()",
  reflective_mmMatrix_types = if (refl$ok) unique(refl$value$mmMatrix[, "type"]) else NULL,
  reflective_estimate_pls = status_of(refl, function(v) list(max_abs_diff_vs_cSEM_PLSc = cmp_csem(v, cs_plsc)[c("paths", "loadings", "weights", "r2")])),
  PLSc_function_on_composite_model = status_of(plsc_fn_on_comp, function(v) list(
    changes_anything_beyond_1e12 = max_abs_diff(sem_paths(v), sem_paths(r_path)) > 1e-12,
    max_abs_diff_paths_vs_classic = max_abs_diff(sem_paths(v), sem_paths(r_path)))),
  PLSc_function_on_reflective_model_again = if (is.null(plsc_fn_on_refl)) NULL else status_of(plsc_fn_on_refl, function(v) list(
    max_abs_diff_paths_vs_reflective = max_abs_diff(sem_paths(v), sem_paths(refl$value))))
)

# ---- 3. summary(): what it exposes, checked against cSEM assess() ------------------------------------
s_cl <- summary(r_path)
s_pc <- if (refl$ok) summary(refl$value) else NULL
a_cl <- assess(cs_path)
a_pc <- assess(cs_plsc)
rel_cmp <- function(s, a, rhoA_source) list(
  alpha_vs_cSEM_RhoT = max_abs_diff(s$reliability[cons, "alpha"], a$RhoT[cons]),
  rhoC_vs_cSEM_RhoC = max_abs_diff(s$reliability[cons, "rhoC"], a$RhoC[cons]),
  AVE_vs_cSEM_AVE = max_abs_diff(s$reliability[cons, "AVE"], a$AVE[cons]),
  rhoA_vs_cSEM_PLSc_reliabilities = max_abs_diff(s$reliability[cons, "rhoA"], rhoA_source[cons])
)
# compare every off-diagonal, non-NA cell of a seminr triangle (its own order) with a symmetric reference by name
pair_cmp <- function(M, Ref) {
  M <- unclass(M); idx <- which(!is.na(M) & row(M) != col(M), arr.ind = TRUE)
  max(abs(M[idx] - Ref[cbind(rownames(M)[idx[, 1]], colnames(M)[idx[, 2]])]))
}
csem_htmt_sym <- function(a) { H <- a$HTMT$htmts; H[upper.tri(H)] <- t(H)[upper.tri(H)]; H }
# f2 by RE-ESTIMATING the model without the predictor (cSEM, independent code path)
f2_reestimated <- function(disattenuate) {
  base <- csem(d, tam_model_syntax("=~"), .disattenuate = disattenuate, .tolerance = 1e-12, .iter_max = 500)
  mapply(function(f, t) {
    st <- TAM_STRUCT; st[[t]] <- setdiff(st[[t]], f)
    lines <- c(sapply(cons, function(k) paste(k, "=~", paste(TAM_BLOCKS[[k]], collapse = " + "))),
               unlist(lapply(names(st), function(k) if (length(st[[k]])) paste(k, "~", paste(st[[k]], collapse = " + ")))))
    r2_without <- if (length(st[[t]])) csem(d, paste(lines, collapse = "\n"), .disattenuate = disattenuate, .tolerance = 1e-12, .iter_max = 500)$Estimates$R2[[t]] else 0
    (base$Estimates$R2[[t]] - r2_without) / (1 - base$Estimates$R2[[t]])
  }, TAM_PATHS$from, TAM_PATHS$to)
}
xl_own <- stats::cor(d[, ind_all], r_path$construct_scores[, cons])
find$summary <- list(
  names = names(s_cl),
  reliability_columns = colnames(s_cl$reliability),
  validity_names = names(s_cl$validity),
  composite_model = list(
    reliability = rel_cmp(s_cl, a_cl, cs_plsc$Estimates$Reliabilities),
    reliability_table = mat_named(unclass(s_cl$reliability)),
    htmt_vs_cSEM = pair_cmp(s_cl$validity$htmt, csem_htmt_sym(a_cl)),
    fl_comment = attr(s_cl$validity$fl_criteria, "comment"),
    fl_lower_vs_cSEM_construct_cor = pair_cmp(s_cl$validity$fl_criteria, cs_path$Estimates$Construct_VCV),
    fl_diag_vs_sqrt_cSEM_AVE = max_abs_diff(diag(unclass(s_cl$validity$fl_criteria)[cons, cons]), sqrt(a_cl$AVE[cons])),
    cross_loadings_vs_cor_indicator_score = max_abs_diff(unclass(s_cl$validity$cross_loadings)[ind_all, cons], xl_own[ind_all, cons]),
    f2_vs_cSEM = max_abs_diff(mapply(function(f, t) s_cl$fSquare[f, t], TAM_PATHS$from, TAM_PATHS$to),
                              mapply(function(f, t) a_cl$F2[t, f], TAM_PATHS$from, TAM_PATHS$to)),
    f2_vs_cSEM_reestimated_without_predictor = max_abs_diff(mapply(function(f, t) s_cl$fSquare[f, t], TAM_PATHS$from, TAM_PATHS$to), f2_reestimated(FALSE)),
    f2_convention = "seminr fSquared() re-estimates the whole PLS model without the predictor (weights change); cSEM assess()/calculatef2() drop the predictor from the regression on the SAME construct correlations",
    vif_antecedents_vs_cSEM = max_abs_diff(c(s_cl$vif_antecedents$ATU[c("PEOU", "PU")], s_cl$vif_antecedents$BI[c("PU", "ATU")]),
                                           c(cs_path$Estimates$VIF$ATU[c("PEOU", "PU")], cs_path$Estimates$VIF$BI[c("PU", "ATU")])),
    vif_items_vs_within_block_formula = max_abs_diff(unlist(lapply(cons, function(k) s_cl$validity$vif_items[[k]][TAM_BLOCKS[[k]]])),
                                                     unlist(lapply(cons, function(k) diag(solve(stats::cor(d[, TAM_BLOCKS[[k]]])))))),
    it_criteria_rows = rownames(s_cl$it_criteria),
    total_effects_vs_cSEM = max_abs_diff(mapply(function(f, t) s_cl$total_effects[f, t], c("PEOU", "PEOU", "PU"), c("BI", "USE", "USE")),
      sapply(c("BI ~ PEOU", "USE ~ PEOU", "USE ~ PU"), function(nm) { te <- a_cl$Effects$Total_effect; te$Estimate[te$Name == nm] }))
  ),
  reflective_plsc_model = if (is.null(s_pc)) NULL else list(
    reliability = rel_cmp(s_pc, a_pc, cs_plsc$Estimates$Reliabilities),
    htmt_vs_cSEM = pair_cmp(s_pc$validity$htmt, csem_htmt_sym(a_pc)),
    fl_lower_vs_cSEM_plsc_construct_cor = pair_cmp(s_pc$validity$fl_criteria, cs_plsc$Estimates$Construct_VCV),
    fl_lower_vs_cSEM_plsc_PROXY_cor = pair_cmp(s_pc$validity$fl_criteria, cs_plsc$Estimates$Proxy_VCV),
    fl_note = "seminr's Fornell-Larcker table for a PLSc model shows correlations of the (non-disattenuated) construct scores, not the PLSc construct correlations",
    f2_vs_cSEM_plsc = max_abs_diff(mapply(function(f, t) s_pc$fSquare[f, t], TAM_PATHS$from, TAM_PATHS$to),
                                   mapply(function(f, t) a_pc$F2[t, f], TAM_PATHS$from, TAM_PATHS$to)),
    f2_vs_cSEM_plsc_reestimated_without_predictor = max_abs_diff(mapply(function(f, t) s_pc$fSquare[f, t], TAM_PATHS$from, TAM_PATHS$to), f2_reestimated(TRUE))
  ),
  rhoA_note = "seminr reports rhoA on the composite (classic) model; cSEM returns rhoA only via a PLSc run (Estimates$Reliabilities) - see csem_assess.json"
)

# ---- 4. bootstrap_model ------------------------------------------------------------------------------
bt <- function(...) { p0 <- proc.time(); v <- quiet(bootstrap_model(...)); p1 <- proc.time() - p0
  list(value = v, seconds = p1[["elapsed"]], cpu_seconds = p1[["user.self"]] + p1[["sys.self"]]) }
draws <- function(b) { A <- b$boot_paths; t(sapply(seq_len(dim(A)[3]), function(i) mapply(function(f, t) A[f, t, i], TAM_PATHS$from, TAM_PATHS$to))) }
b1 <- bt(r_path, nboot = 100, seed = 123, cores = 1)
b2 <- bt(r_path, nboot = 100, seed = 123, cores = 1)
b3 <- bt(r_path, nboot = 100, seed = 124, cores = 1)
b4 <- try_capture(bt(r_path, nboot = 100, seed = 123, cores = 2))
D1 <- draws(b1$value); D3 <- draws(b3$value)
sb <- summary(b1$value)
bp <- sb$bootstrapped_paths
ci_rows <- paste0(TAM_PATHS$from, "  ->  ", TAM_PATHS$to)
q_types <- lapply(1:9, function(ty) list(type = ty, max_abs_diff = max(abs(
  rbind(bp[ci_rows, "2.5% CI"], bp[ci_rows, "97.5% CI"]) - apply(D1, 2, stats::quantile, c(0.025, 0.975), type = ty, names = FALSE)))))
own_idx <- { set.seed(123 + 1); sample.int(n, replace = TRUE) }
own_first <- sem_paths(quiet(estimate_pls(d[own_idx, ], mm_comp, sm, inner_weights = path_weighting, missing = mean_replacement)))
find$bootstrap <- list(
  where_raw_draws_live = "boot$boot_paths: array [from, to, replication]; also boot_loadings, boot_weights, boot_HTMT, boot_total_paths",
  bookkeeping = list(boots = b1$value$boots, boots_requested = b1$value$boots_requested, boots_dropped = b1$value$boots_dropped, seed = b1$value$seed),
  same_seed_identical = identical(b1$value$boot_paths, b2$value$boot_paths),
  different_seed_identical = identical(b1$value$boot_paths, b3$value$boot_paths),
  cores_2_vs_cores_1_same_seed = status_of(b4, function(v) list(identical = identical(v$value$boot_paths, b1$value$boot_paths),
                                                               seconds = v$seconds)),
  seed_scheme_from_source = "replication i calls set.seed(seed + i) then sample.int(n, replace = TRUE) (Mersenne-Twister); identical for any core count",
  first_draw_vs_own_set_seed_plus_1_refit = max_abs_diff(D1[1, ], own_first),
  OVERLAP_seed_S_plus_1 = list(
    note = "draw i of seed 124 must equal draw i + 1 of seed 123 if the scheme is seed + i",
    max_abs_diff_seed124_draws_1_to_99_vs_seed123_draws_2_to_100 = max_abs_diff(D3[1:99, ], D1[2:100, ])
  ),
  summary_bootstrapped_paths_columns = colnames(bp),
  percentile_ci_vs_quantile_types = q_types,
  boot_sd_vs_sd_of_draws = max_abs_diff(bp[ci_rows, "Bootstrap SD"], apply(D1, 2, stats::sd)),
  t_stat_is_estimate_over_sd = max_abs_diff(bp[ci_rows, "T Stat."], bp[ci_rows, "Original Est."] / bp[ci_rows, "Bootstrap SD"]),
  summary_alpha_argument = names(formals(getS3method("summary", "boot_seminr_model"))),
  seconds_per_100_cores_1 = b1$seconds, cpu_seconds_per_100_cores_1 = b1$cpu_seconds,
  failure_policy_from_source = "a replication that raises an error OR A WARNING returns NA and is dropped; counted in boots_dropped. No 'replace' option.",
  specific_effect_significance = status_of(try_capture(specific_effect_significance(b1$value, from = "PEOU", through = c("PU", "ATU"), to = "BI", alpha = 0.05)),
                                           function(v) as.list(stats::setNames(as.numeric(v), names(v))))
)
plsc_boot <- try_capture(bt(refl$value, nboot = 30, seed = 1, cores = 1))
find$bootstrap$plsc_model_30 = status_of(plsc_boot, function(v) list(boots = v$value$boots, dropped = v$value$boots_dropped, seconds = v$seconds))

# ---- 5. predict_pls ------------------------------------------------------------------------------------------
pp <- try_capture(quiet(predict_pls(r_path, technique = predict_DA, noFolds = 10, reps = 1)))
find$predict_pls <- list(
  status = "smoke-only",
  call = "predict_pls(model, technique = predict_DA, noFolds = 10, reps = 1)",
  seed_argument = "none - fold assignment uses the global RNG; set.seed() before the call",
  run = status_of(pp, function(v) list(class = class(v), names = names(v),
    summary_names = names(summary(v)),
    printed = utils::head(utils::capture.output(print(summary(v))), 30)))
)
set.seed(9); pa <- quiet(predict_pls(r_path, technique = predict_DA, noFolds = 5, reps = 1))
set.seed(9); pb <- quiet(predict_pls(r_path, technique = predict_DA, noFolds = 5, reps = 1))
find$predict_pls$reproducible_with_set_seed <- identical(pa$PLS_out_of_sample, pb$PLS_out_of_sample)

# ---- 6. missing data -----------------------------------------------------------------------------------------
dn <- d; dn$USEF1[c(3, 50, 400)] <- NA
mn <- try_capture(estimate_pls(dn, mm_comp, sm))
find$missing <- list(
  default = "missing = mean_replacement: NA replaced by the column mean BEFORE estimation; warning only if > 5% missing in a column",
  run_with_3_NA = status_of(mn, function(v) list(n_rows_used = nrow(v$data), any_na_left = anyNA(v$data),
                                                max_abs_path_diff_vs_complete = max_abs_diff(sem_paths(v), sem_paths(pls_default)))),
  messages_printed = mn$messages
)

# ---- 7. CB-SEM: estimate_cbsem / estimate_cfa vs lavaan --------------------------------------------------------
lav_model <- tam_model_syntax("=~")
cb <- try_capture(quiet(estimate_cbsem(d, mm_refl, sm)))
cb_ml <- try_capture(quiet(estimate_cbsem(d, mm_refl, sm, estimator = "ML")))
# seminr's generated lavaan call uses std.lv = TRUE (factor variances fixed to 1), see lavInspect(.,"options")
lv_mlr <- sem(lav_model, data = d, estimator = "MLR", std.lv = TRUE)
lv_ml <- sem(lav_model, data = d, estimator = "ML", std.lv = TRUE)
lv_ml_marker <- sem(lav_model, data = d, estimator = "ML")
cfa_s <- try_capture(quiet(estimate_cfa(d, mm_refl)))
lv_cfa <- cfa(tam_model_syntax("=~", structural = FALSE), data = d, estimator = "MLR", std.lv = TRUE)
pe_cmp <- function(fit_seminr_lavaan, lv) {
  a <- lavaan::parameterEstimates(fit_seminr_lavaan); b <- lavaan::parameterEstimates(lv)
  key <- function(p) paste(p$lhs, p$op, p$rhs)
  m <- match(key(a), key(b))
  list(n_params_seminr = nrow(a), n_matched = sum(!is.na(m)),
       est = max(abs(a$est - b$est[m]), na.rm = TRUE), se = max(abs(a$se - b$se[m]), na.rm = TRUE))
}
find$cbsem <- list(
  estimate_cbsem_default_estimator = formals_of(estimate_cbsem)$estimator,
  default_MLR = status_of(cb, function(v) list(class = class(v), names = names(v),
    lavaan_object_slot = "lavaan_output" %in% names(v),
    vs_lavaan_sem_MLR = pe_cmp(v$lavaan_output, lv_mlr),
    lavaan_syntax_generated = v$lavaan_model)),
  ML = status_of(cb_ml, function(v) list(vs_lavaan_sem_ML_std_lv = pe_cmp(v$lavaan_output, lv_ml),
    vs_lavaan_sem_ML_marker_default = pe_cmp(v$lavaan_output, lv_ml_marker),
    std_all_vs_lavaan_marker = { a <- standardizedSolution(v$lavaan_output); b <- standardizedSolution(lv_ml_marker)
      m <- match(paste(a$lhs, a$op, a$rhs), paste(b$lhs, b$op, b$rhs)); max(abs(a$est.std - b$est.std[m])) },
    lavaan_options = lavInspect(v$lavaan_output, "options")[c("std.lv", "estimator", "se", "test", "missing")],
    seminr_path_coef_vs_lavaan_std_all = { P <- v$path_coef; b <- standardizedSolution(lv_ml_marker)
      max(abs(mapply(function(f, t) P[f, t], TAM_PATHS$from, TAM_PATHS$to) -
              mapply(function(f, t) b$est.std[b$lhs == t & b$op == "~" & b$rhs == f], TAM_PATHS$from, TAM_PATHS$to))) })),
  estimate_cfa_default = status_of(cfa_s, function(v) list(vs_lavaan_cfa_MLR = pe_cmp(v$lavaan_output, lv_cfa))),
  summary_names = if (cb$ok) names(summary(cb$value)) else NULL,
  summary_quality_names = if (cb$ok) names(summary(cb$value)$quality) else NULL,
  note = "seminr CB-SEM is a wrapper around lavaan; the comparison checks that the generated lavaan model is the same model"
)

# ---- parity file: seminr classic PLS Mode A, path weighting ------------------------------------------------------
loads <- data.frame(construct = rep(cons, lengths(TAM_BLOCKS)), indicator = ind_all, est = sem_block(r_path$outer_loadings), stringsAsFactors = FALSE)
wts <- data.frame(construct = rep(cons, lengths(TAM_BLOCKS)), indicator = ind_all, est = sem_block(r_path$outer_weights), stringsAsFactors = FALSE)
write_parity(
  engine = "seminr", variant = "pls-path",
  options = list(measurement = "composite(k, items, weights = mode_A)", inner_weights = "path_weighting", stopCriterion = TOL_EXP, maxIt = 300),
  paths = data.frame(from = TAM_PATHS$from, to = TAM_PATHS$to, est = unname(sem_paths(r_path)), stringsAsFactors = FALSE),
  loadings = loads, weights = wts,
  r2 = vec_named(sem_r2(r_path)),
  extra = list(
    r2adj = vec_named(r_path$rSquared["AdjRsq", names(TAM_STRUCT)]),
    iterations = r_path$iterations,
    reliability = mat_named(unclass(s_cl$reliability)),
    crossCheckMaxAbsDiff_vs_cSEM_classic_path = cmp_csem(r_path, cs_path)
  )
)

write_evidence("seminr", find, packages = c("seminr", "cSEM", "lavaan"))
