# Phase 0 spike - cSEM::doIPMA() and the IPMA scaling conventions (task item h).
#
# Questions answered with executed evidence:
#   - what doIPMA() needs and returns (construct and indicator level)
#   - how performance is scaled (it is NOT rescaled to 0-100 by doIPMA)
#   - how a first-principles IPMA (original scale endpoints 1..7 -> 0..100,
#     unstandardised sum-to-one weights, unstandardised total effects) relates
#     to doIPMA()'s numbers
#
# Evidence: docs/validation/phase-0/evidence/r/csem_ipma.json

source(file.path(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "_common.R"))
source(file.path(ENGINE_DIR, "spike", "_ref_pls.R"))
suppressPackageStartupMessages(library(cSEM))

d <- load_tam()
cons <- names(TAM_BLOCKS)
ind_all <- unlist(TAM_BLOCKS, use.names = FALSE)
TOL <- 1e-10
find <- list()

rescale_0_100 <- function(X, lo, hi) as.data.frame(mapply(function(x, a, b) (x - a) / (b - a) * 100, X, lo, hi, SIMPLIFY = FALSE))

# Scale endpoints. The task specification said "1 and 7" for every indicator, but the USE items are NOT
# 1..7 items: USE1-USE3 take values 1..6 and USE4 takes values 1..11. The plain-JSON side file
# TEMP/Example - TAM/Data.txt.settings records scaleInformation minValue/maxValue per indicator; those
# values coincide with the observed min/max, so they may have been detected rather than declared.
# Main analysis: per-indicator endpoints from the settings file. Section `spec_1_7_everywhere` shows
# what the literal 1..7 rule does.
settings <- jsonlite::fromJSON(file.path(dirname(TAM_DATA), "Data.txt.settings"), simplifyVector = FALSE)
LO <- stats::setNames(sapply(settings$indicators, function(i) i$scaleInformation$minValue), sapply(settings$indicators, function(i) i$name))[ind_all]
HI <- stats::setNames(sapply(settings$indicators, function(i) i$scaleInformation$maxValue), sapply(settings$indicators, function(i) i$name))[ind_all]
stopifnot(!anyNA(LO), !anyNA(HI))
ONE_TO_SEVEN <- names(TAM_BLOCKS)[sapply(TAM_BLOCKS, function(b) all(LO[b] == 1 & HI[b] == 7))]
d100 <- rescale_0_100(d[, ind_all], LO, HI)

m_comp <- tam_model_syntax("<~")
m_cf <- tam_model_syntax("=~")
fit_comp <- function(data) csem(data, m_comp, .PLS_modes = "modeA", .tolerance = TOL, .iter_max = 300)

ipma_dump <- function(ip) list(
  class = class(ip), names = names(ip),
  construct_importance = mat_named(ip$Construct$Importance),
  construct_performance = vec_named(ip$Construct$Performance),
  indicator_importance = mat_named(ip$Indicator$Importance),
  indicator_performance = vec_named(ip$Indicator$Performance),
  construct_names = ip$Construct_names, indicator_names = ip$Indicator_names
)

find$api <- list(
  doIPMA_formals = formals_of(doIPMA),
  target_argument = "none - doIPMA(.object) returns the full construct x construct importance matrix; pick the row of the target construct yourself",
  plot_method_formals = formals_of(getS3method("plot", "cSEMIPMA")),
  importance_matrix_orientation = "Importance[target, predecessor] = unstandardised total effect of predecessor on target",
  preconditions_from_source = c("Pearson indicator correlation", ".approach_weights = 'PLS-PM'", "linear model", ".approach_paths = 'OLS'",
                                "no second-order constructs", "warning if any construct is a common factor ('=~')", "warning if any weight is negative")
)

# ---- doIPMA on the four relevant estimation flavours ---------------------------------
runs <- list(
  composite_modeA_raw_1_7   = try_capture(doIPMA(fit_comp(d))),
  composite_modeA_0_100     = try_capture(doIPMA(fit_comp(d100))),
  commonfactor_classic_raw  = try_capture(doIPMA(csem(d, m_cf, .disattenuate = FALSE, .tolerance = TOL))),
  commonfactor_plsc_raw     = try_capture(doIPMA(csem(d, m_cf, .tolerance = TOL)))
)
find$doIPMA_runs <- lapply(runs, function(tc) status_of(tc, ipma_dump))
ip_raw <- runs$composite_modeA_raw_1_7$value
ip_100 <- runs$composite_modeA_0_100$value

# ---- first principles (no cSEM code involved) ------------------------------------------
first_principles_ipma <- function(X, lo, hi) {
  ref <- ref_pls(X, TAM_BLOCKS, TAM_STRUCT, scheme = "path", modes = "A", tol = TOL, max_iter = 300)
  X100 <- as.matrix(rescale_0_100(X[, ind_all], lo, hi))
  Wn <- ref$weights[cons, ind_all] * 0
  for (k in cons) {
    b <- TAM_BLOCKS[[k]]
    w_unstd <- ref$weights[k, b] / apply(X100[, b, drop = FALSE], 2, stats::sd)   # unstandardise
    Wn[k, b] <- w_unstd / sum(w_unstd)                                             # normalise to sum 1
  }
  scores <- X100 %*% t(Wn)                                                         # weighted mean, 0..100
  perf_construct <- colMeans(scores)
  # unstandardised structural coefficients by OLS on the unstandardised scores
  Bu <- matrix(0, length(cons), length(cons), dimnames = list(cons, cons))
  for (to in names(TAM_STRUCT)) {
    fm <- stats::lm.fit(cbind(1, scores[, TAM_STRUCT[[to]], drop = FALSE]), scores[, to])
    Bu[to, TAM_STRUCT[[to]]] <- fm$coefficients[-1]
  }
  total_unstd <- solve(diag(length(cons)) - Bu) - diag(length(cons))
  total_std <- solve(diag(length(cons)) - ref$paths[cons, cons]) - diag(length(cons))
  sds <- apply(scores, 2, stats::sd)
  list(weights_normed = Wn, scores = scores, performance_construct = perf_construct,
       performance_indicator = colMeans(X100), importance_construct = total_unstd,
       importance_from_std_times_sd_ratio = total_std * outer(sds, 1 / sds),
       weight_row_sums = rowSums(Wn), score_range = range(scores))
}
fp <- first_principles_ipma(d, LO, HI)
ind_importance <- function(target) {
  unlist(lapply(setdiff(cons, target), function(k) {
    stats::setNames(fp$weights_normed[k, TAM_BLOCKS[[k]]] * fp$importance_construct[target, k], TAM_BLOCKS[[k]])
  }))
}

table_for <- function(target) {
  pred <- cons[fp$importance_construct[target, ] != 0]
  data.frame(
    construct = pred,
    importance_first_principles = fp$importance_construct[target, pred],
    importance_doIPMA_0_100_input = ip_100$Construct$Importance[target, pred],
    importance_doIPMA_raw_input = ip_raw$Construct$Importance[target, pred],
    performance_first_principles = fp$performance_construct[pred],
    performance_doIPMA_0_100_input = ip_100$Construct$Performance[pred],
    performance_doIPMA_raw_input = ip_raw$Construct$Performance[pred],
    performance_doIPMA_raw_then_rescaled_1_7 = ifelse(pred %in% ONE_TO_SEVEN, (ip_raw$Construct$Performance[pred] - 1) / 6 * 100, NA),
    row.names = NULL
  )
}
find$first_principles <- list(
  endpoints_used = list(lo = vec_named(LO), hi = vec_named(HI), constructs_with_all_items_1_7 = ONE_TO_SEVEN),
  conventions = list(
    indicator_rescaling = "(x - lo) / (hi - lo) * 100 with the scale endpoints from Data.txt.settings (1..7 for PU, PEOU, ATU, BI; 1..6 for USE1-3; 1..11 for USE4), never the observed min/max of the analysed sample",
    weights = "standardised Mode A outer weights divided by sd(rescaled indicator), then divided by their per-construct sum (sum to one)",
    construct_score = "weighted mean of the rescaled indicators (0..100 by construction)",
    construct_performance = "mean of the construct score",
    indicator_performance = "mean of the rescaled indicator",
    construct_importance = "unstandardised total effect on the target (OLS on the unstandardised scores, then (I - B)^-1 - I)",
    indicator_importance = "normalised weight x unstandardised total effect of its construct on the target",
    sd = "stats::sd (n - 1 denominator); only ratios of SDs enter, so the denominator convention cancels"
  ),
  weight_row_sums = vec_named(fp$weight_row_sums),
  score_range = fp$score_range,
  target_BI = table_for("BI"),
  target_USE = table_for("USE"),
  indicator_level_target_BI = data.frame(
    indicator = names(ind_importance("BI")),
    importance_first_principles = unname(ind_importance("BI")),
    importance_doIPMA_0_100_input = unname(ip_100$Indicator$Importance["BI", names(ind_importance("BI"))]),
    performance_first_principles = unname(fp$performance_indicator[names(ind_importance("BI"))]),
    performance_doIPMA_0_100_input = unname(ip_100$Indicator$Performance[names(ind_importance("BI"))]),
    row.names = NULL
  )
)

offd <- function(M) M[cons, cons][fp$importance_construct != 0]
find$relations_max_abs_diff <- list(
  importance__first_principles_VS_doIPMA_on_0_100_data = max_abs_diff(offd(ip_100$Construct$Importance), offd(fp$importance_construct)),
  importance__OLS_on_unstd_scores_VS_std_effect_times_sd_ratio = max_abs_diff(offd(fp$importance_from_std_times_sd_ratio), offd(fp$importance_construct)),
  performance__first_principles_VS_doIPMA_on_0_100_data = max_abs_diff(ip_100$Construct$Performance[cons], fp$performance_construct[cons]),
  performance__first_principles_VS_rescaled_doIPMA_on_raw_data_1_7_constructs = max_abs_diff((ip_raw$Construct$Performance[ONE_TO_SEVEN] - 1) / 6 * 100, fp$performance_construct[ONE_TO_SEVEN]),
  importance__doIPMA_raw_VS_doIPMA_0_100_same_scale_everywhere = max_abs_diff(offd(ip_raw$Construct$Importance), offd(ip_100$Construct$Importance)),
  indicator_performance__first_principles_VS_doIPMA_0_100 = max_abs_diff(ip_100$Indicator$Performance[ind_all], fp$performance_indicator[ind_all]),
  indicator_importance_BI__first_principles_VS_doIPMA_0_100 = max_abs_diff(ip_100$Indicator$Importance["BI", names(ind_importance("BI"))], ind_importance("BI")),
  normalised_weights__first_principles_VS_getConstructScores = max_abs_diff(
    getConstructScores(fit_comp(d100), .standardized = FALSE)$W_used[cons, ind_all], fp$weights_normed),
  doIPMA_raw_performance_range = range(ip_raw$Construct$Performance),
  doIPMA_0_100_performance_range = range(ip_100$Construct$Performance)
)

# ---- what doIPMA does NOT do: it never rescales -----------------------------------------
obs_min <- sapply(d[, ind_all], min); obs_max <- sapply(d[, ind_all], max)
sub <- d[apply(d[, ind_all] >= 3, 1, all), ]
sub_obs_min <- sapply(sub[, ind_all], min); sub_obs_max <- sapply(sub[, ind_all], max)
fp_sub_theory <- first_principles_ipma(sub, LO, HI)
fp_sub_observed <- first_principles_ipma(sub, sub_obs_min, sub_obs_max)
ip_sub_raw <- doIPMA(fit_comp(sub))
find$observed_vs_theoretical_endpoints <- list(
  full_data_observed_min = as.list(obs_min), full_data_observed_max = as.list(obs_max),
  full_data_observed_equals_theoretical = all(obs_min == 1) && all(obs_max == 7),
  subsample = "rows where every indicator >= 3 (so the observed minimum is 3, not the scale minimum 1)",
  subsample_n = nrow(sub),
  subsample_observed_min = as.list(sub_obs_min),
  performance_theoretical_endpoints = vec_named(fp_sub_theory$performance_construct),
  performance_observed_minmax = vec_named(fp_sub_observed$performance_construct),
  performance_doIPMA_raw_rescaled_with_1_7 = vec_named((ip_sub_raw$Construct$Performance[ONE_TO_SEVEN] - 1) / 6 * 100),
  max_abs_diff_theoretical_vs_observed = max_abs_diff(fp_sub_theory$performance_construct, fp_sub_observed$performance_construct),
  max_abs_diff_doIPMA_raw_rescaled_vs_theoretical_1_7_constructs = max_abs_diff((ip_sub_raw$Construct$Performance[ONE_TO_SEVEN] - 1) / 6 * 100, fp_sub_theory$performance_construct[ONE_TO_SEVEN]),
  conclusion = "doIPMA() works on the data exactly as supplied. Performance is in the units of the input data. The caller decides the 0-100 mapping; using observed min/max instead of the scale endpoints changes the answer."
)

# ---- mixed scale endpoints: rescaling BEFORE estimation is mandatory -------------------------
d_mixed <- d
for (v in TAM_BLOCKS$PU) d_mixed[[v]] <- 1 + (d[[v]] - 1) * 4 / 6          # pretend PU was asked on a 1..5 scale
lo <- LO; hi <- HI
hi[TAM_BLOCKS$PU] <- 5
ip_mixed_raw <- doIPMA(fit_comp(d_mixed))
d_mixed_100 <- rescale_0_100(d_mixed[, ind_all], lo, hi)
ip_mixed_100 <- doIPMA(fit_comp(d_mixed_100))
find$mixed_scale_endpoints <- list(
  setup = "PU indicators linearly mapped to a 1..5 scale, everything else 1..7",
  importance_on_BI_doIPMA_raw_mixed = as.list(ip_mixed_raw$Construct$Importance["BI", c("PEOU", "PU", "ATU")]),
  importance_on_BI_doIPMA_after_0_100_rescaling = as.list(ip_mixed_100$Construct$Importance["BI", c("PEOU", "PU", "ATU")]),
  importance_on_BI_original_all_1_7 = as.list(ip_100$Construct$Importance["BI", c("PEOU", "PU", "ATU")]),
  max_abs_diff_rescaled_mixed_vs_original = max_abs_diff(offd(ip_mixed_100$Construct$Importance), offd(ip_100$Construct$Importance)),
  max_abs_diff_raw_mixed_vs_original = max_abs_diff(offd(ip_mixed_raw$Construct$Importance), offd(ip_100$Construct$Importance)),
  conclusion = "Unstandardised total effects depend on the indicator units. With unequal scale endpoints the importance is only comparable after every indicator was mapped to 0-100 with its own theoretical endpoints BEFORE csem()."
)

# ---- common-factor objects: warnings and numeric differences -----------------------------------
find$common_factor_objects <- list(
  classic_warning = runs$commonfactor_classic_raw$warnings,
  plsc_warning = runs$commonfactor_plsc_raw$warnings,
  classic_importance_max_abs_diff_vs_composite = max_abs_diff(offd(runs$commonfactor_classic_raw$value$Construct$Importance), offd(ip_raw$Construct$Importance)),
  classic_performance_max_abs_diff_vs_composite = max_abs_diff(runs$commonfactor_classic_raw$value$Construct$Performance[cons], ip_raw$Construct$Performance[cons]),
  plsc_importance_max_abs_diff_vs_composite = max_abs_diff(offd(runs$commonfactor_plsc_raw$value$Construct$Importance), offd(ip_raw$Construct$Importance)),
  conclusion = "For IPMA estimate the model as composites with Mode A weights ('<~' + .PLS_modes = 'modeA'). A '=~' model with .disattenuate = FALSE gives the same numbers plus a warning; a PLSc object mixes disattenuated effects with composite scores and must not be used."
)

# ---- bootstrap CIs for IPMA via .user_funs (smoke) ------------------------------------------------
uf <- try_capture(csem(d100, m_comp, .PLS_modes = "modeA", .resample_method = "bootstrap", .R = 20, .seed = 5,
                       .user_funs = list(
                         ipma_importance_BI = function(.object) doIPMA(.object)$Construct$Importance["BI", c("PEOU", "PU", "ATU")],
                         ipma_performance = function(.object) doIPMA(.object)$Construct$Performance)))
find$bootstrap_ipma_smoke <- status_of(uf, function(v) {
  e <- v$Estimates$Estimates_resample$Estimates1
  list(importance_draws_dim = dim(e$ipma_importance_BI$Resampled), performance_draws_dim = dim(e$ipma_performance$Resampled),
       performance_colnames = colnames(e$ipma_performance$Resampled),
       importance_sd = as.list(apply(e$ipma_importance_BI$Resampled, 2, stats::sd)),
       performance_sd = as.list(apply(e$ipma_performance$Resampled, 2, stats::sd)))
})

# ---- the literal "1 and 7 for every indicator" rule ------------------------------------------------
lo7 <- stats::setNames(rep(1, length(ind_all)), ind_all); hi7 <- stats::setNames(rep(7, length(ind_all)), ind_all)
fp7 <- first_principles_ipma(d, lo7, hi7)
ip7 <- doIPMA(fit_comp(rescale_0_100(d[, ind_all], lo7, hi7)))
find$spec_1_7_everywhere <- list(
  rescaled_USE4_range = range(rescale_0_100(d[, "USE4", drop = FALSE], 1, 7)[[1]]),
  rescaled_USE1_range = range(rescale_0_100(d[, "USE1", drop = FALSE], 1, 7)[[1]]),
  performance = vec_named(fp7$performance_construct),
  importance_on_BI = as.list(fp7$importance_construct["BI", c("PEOU", "PU", "ATU")]),
  importance_on_USE = as.list(fp7$importance_construct["USE", c("PEOU", "PU", "ATU", "BI")]),
  importance_on_USE_with_settings_endpoints = as.list(fp$importance_construct["USE", c("PEOU", "PU", "ATU", "BI")]),
  doIPMA_vs_first_principles_importance = max_abs_diff(offd(ip7$Construct$Importance), offd(fp7$importance_construct)),
  doIPMA_vs_first_principles_performance = max_abs_diff(ip7$Construct$Performance[cons], fp7$performance_construct[cons]),
  max_abs_diff_importance_on_BI_vs_settings_endpoints = max_abs_diff(fp7$importance_construct["BI", ], fp$importance_construct["BI", ]),
  conclusion = "Targets whose predecessors and own items are all 1..7 (BI) are unaffected. Anything involving USE changes: with 1..7, USE4 maps to 0..166.7 and USE1-3 can never reach 100, so the USE performance and every importance ON USE depend on the endpoint choice."
)

write_evidence("csem_ipma", find, packages = c("cSEM"))
