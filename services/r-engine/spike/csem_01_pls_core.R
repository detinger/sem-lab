# Phase 0 spike - cSEM core PLS estimation (task items a, b, c, d).
#
#   a. inner weighting schemes; classic PLS Mode A WITHOUT consistency correction
#   b. PLSc for common-factor constructs
#   c. Mode B composites; mixed Mode A / Mode B
#   d. convergence information, iteration/tolerance control, verify()
#
# Every numeric claim is checked against services/r-engine/spike/_ref_pls.R, an
# independent base-R implementation of the PLS algorithm.
#
# Evidence: docs/validation/phase-0/evidence/r/csem_pls_core.json
#           docs/validation/phase-0/evidence/r/parity_csem_pls-modeA-{path,centroid,factorial}.json
#           docs/validation/phase-0/evidence/r/parity_csem_plsc.json

source(file.path(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "_common.R"))
source(file.path(ENGINE_DIR, "spike", "_ref_pls.R"))
suppressPackageStartupMessages(library(cSEM))

d <- load_tam()
m_cf   <- tam_model_syntax("=~")   # all constructs as common factors
m_comp <- tam_model_syntax("<~")   # all constructs as composites
TOL <- 1e-10                        # tight tolerance for engine-to-engine comparison
ITER <- 300L
find <- list()

describe <- function(res) {
  list(
    construct_type = as.list(res$Information$Model$construct_type),
    modes = as.list(unlist(res$Information$Weight_info$Modes)),
    iterations = res$Information$Weight_info$Number_iterations,
    converged = res$Information$Weight_info$Convergence_status,
    disattenuate_arg = res$Information$Arguments$.disattenuate,
    reliabilities = vec_named(res$Estimates$Reliabilities),
    paths = csem_paths_df(res),
    r2 = vec_named(res$Estimates$R2),
    loadings_PU = vec_named(res$Estimates$Loading_estimates["PU", TAM_BLOCKS$PU]),
    weights_PU = vec_named(res$Estimates$Weight_estimates["PU", TAM_BLOCKS$PU])
  )
}
cmp_ref <- function(res, ref) {
  list(
    paths = max_abs_diff(csem_paths_df(res)$est, mapply(function(f, t) ref$paths[t, f], TAM_PATHS$from, TAM_PATHS$to)),
    loadings = max_abs_diff(csem_block_df(res$Estimates$Loading_estimates)$est, csem_block_df(ref$loadings)$est),
    weights = max_abs_diff(csem_block_df(res$Estimates$Weight_estimates)$est, csem_block_df(ref$weights)$est),
    r2 = max_abs_diff(res$Estimates$R2[names(ref$r2)], ref$r2)
  )
}

# ---- API surface --------------------------------------------------------------
find$api <- list(
  csem_formals = formals_of(csem),
  inner_weight_scheme_argument = ".PLS_weight_scheme_inner",
  inner_weight_scheme_values = eval(formals(csem)$.PLS_weight_scheme_inner),
  approach_weights_values = eval(formals(csem)$.approach_weights),
  conv_criterion_values = eval(formals(csem)$.conv_criterion),
  defaults = list(.tolerance = formals(csem)$.tolerance, .iter_max = formals(csem)$.iter_max,
                  .disattenuate = formals(csem)$.disattenuate),
  result_classes = class(csem(d, m_cf)),
  estimates_slots = names(csem(d, m_cf)$Estimates),
  information_slots = names(csem(d, m_cf)$Information)
)

# ---- (a)+(b)+(c) how "=~" / "<~" / .disattenuate / .PLS_modes interact ---------
specs <- list(
  cf_default               = list(model = m_cf,   args = list()),
  cf_disattenuate_false    = list(model = m_cf,   args = list(.disattenuate = FALSE)),
  cf_disatt_false_modeA    = list(model = m_cf,   args = list(.disattenuate = FALSE, .PLS_modes = "modeA")),
  cf_modeB_default         = list(model = m_cf,   args = list(.PLS_modes = "modeB")),
  cf_modeB_disatt_false    = list(model = m_cf,   args = list(.PLS_modes = "modeB", .disattenuate = FALSE)),
  comp_default             = list(model = m_comp, args = list()),
  comp_disattenuate_false  = list(model = m_comp, args = list(.disattenuate = FALSE)),
  comp_modeA               = list(model = m_comp, args = list(.PLS_modes = "modeA")),
  comp_modeA_disatt_false  = list(model = m_comp, args = list(.PLS_modes = "modeA", .disattenuate = FALSE))
)
fits <- lapply(specs, function(s) {
  try_capture(do.call(csem, c(list(.data = d, .model = s$model, .tolerance = TOL, .iter_max = ITER), s$args)))
})
find$interaction_matrix <- lapply(names(specs), function(nm) {
  tc <- fits[[nm]]
  c(list(id = nm, operator = if (identical(specs[[nm]]$model, m_cf)) "=~" else "<~", args = specs[[nm]]$args),
    status_of(tc, describe))
})
names(find$interaction_matrix) <- names(specs)

val <- function(nm) fits[[nm]]$value
path_vec <- function(nm) csem_paths_df(val(nm))$est
find$equivalences <- list(
  note = "max |difference| in the six path coefficients between specifications",
  classicA__cf_disatt_false_VS_comp_modeA = max_abs_diff(path_vec("cf_disattenuate_false"), path_vec("comp_modeA")),
  classicA__cf_disatt_false_VS_cf_disatt_false_modeA = max_abs_diff(path_vec("cf_disattenuate_false"), path_vec("cf_disatt_false_modeA")),
  classicA__comp_modeA_VS_comp_modeA_disatt_false = max_abs_diff(path_vec("comp_modeA"), path_vec("comp_modeA_disatt_false")),
  plsc_VS_classicA = max_abs_diff(path_vec("cf_default"), path_vec("cf_disattenuate_false")),
  modeB__comp_default_VS_comp_disatt_false = max_abs_diff(path_vec("comp_default"), path_vec("comp_disattenuate_false")),
  modeB__comp_default_VS_cf_modeB_disatt_false = max_abs_diff(path_vec("comp_default"), path_vec("cf_modeB_disatt_false")),
  cf_modeB_default_VS_comp_default = max_abs_diff(path_vec("cf_modeB_default"), path_vec("comp_default")),
  weights_identical_plsc_vs_classicA = max_abs_diff(val("cf_default")$Estimates$Weight_estimates,
                                                    val("cf_disattenuate_false")$Estimates$Weight_estimates)
)

# ---- (a) inner weighting schemes, classic Mode A, vs independent reference ------
schemes <- c("path", "centroid", "factorial")
scheme_fits <- list()
find$weighting_schemes <- list()
for (s in schemes) {
  opts <- list(.disattenuate = FALSE, .PLS_weight_scheme_inner = s, .tolerance = TOL, .iter_max = ITER)
  tc <- try_capture(do.call(csem, c(list(.data = d, .model = m_cf), opts)))
  res <- tc$value
  scheme_fits[[s]] <- res
  ref <- ref_pls(d, TAM_BLOCKS, TAM_STRUCT, scheme = s, modes = "A", tol = TOL, max_iter = ITER)
  find$weighting_schemes[[s]] <- c(status_of(tc, describe), list(
    options = opts,
    reference_iterations = ref$iterations,
    max_abs_diff_vs_reference = cmp_ref(res, ref)
  ))
  rel <- assess(res, .quality_criterion = c("ave", "rho_C", "rho_C_weighted", "rho_T"), .only_common_factors = TRUE)
  write_parity(
    engine = "cSEM", variant = paste0("pls-modeA-", s),
    options = c(list(.model_operator = "=~"), opts),
    paths = csem_paths_df(res),
    loadings = csem_block_df(res$Estimates$Loading_estimates),
    weights = csem_block_df(res$Estimates$Weight_estimates),
    r2 = vec_named(res$Estimates$R2),
    extra = list(
      r2adj = vec_named(res$Estimates$R2adj),
      iterations = res$Information$Weight_info$Number_iterations,
      converged = res$Information$Weight_info$Convergence_status,
      weightNormalisation = "standardised weights: composite variance w'Sw = 1 on the indicator correlation matrix",
      constructCorrelations = mat_named(res$Estimates$Construct_VCV),
      ave = vec_named(rel$AVE), rhoC = vec_named(rel$RhoC), rhoA = vec_named(rel$RhoC_weighted), cronbachAlpha = vec_named(rel$RhoT),
      independentReferenceMaxAbsDiff = cmp_ref(res, ref)
    )
  )
}
find$weighting_schemes$between_scheme_path_diffs <- list(
  path_vs_centroid = max_abs_diff(csem_paths_df(scheme_fits$path)$est, csem_paths_df(scheme_fits$centroid)$est),
  path_vs_factorial = max_abs_diff(csem_paths_df(scheme_fits$path)$est, csem_paths_df(scheme_fits$factorial)$est)
)
find$weighting_schemes$invalid_value <- status_of(try_capture(csem(d, m_cf, .PLS_weight_scheme_inner = "pathweighting")))
find$weighting_schemes$partial_match <- status_of(try_capture(csem(d, m_cf, .PLS_weight_scheme_inner = "fact")),
                                                  function(v) v$Information$Arguments$.PLS_weight_scheme_inner)

# ---- (b) PLSc --------------------------------------------------------------------
opts_plsc <- list(.disattenuate = TRUE, .PLS_weight_scheme_inner = "path", .tolerance = TOL, .iter_max = ITER)
tc <- try_capture(do.call(csem, c(list(.data = d, .model = m_cf), opts_plsc)))
plsc <- tc$value
ref_c <- ref_pls(d, TAM_BLOCKS, TAM_STRUCT, scheme = "path", modes = "A", tol = TOL, max_iter = ITER, consistent = TRUE)
classic <- scheme_fits$path
find$plsc <- c(status_of(tc, describe), list(
  options = opts_plsc,
  how_requested = "constructs written with '=~' AND .disattenuate = TRUE (the default). No separate PLSc switch exists.",
  correction_factor_argument = list(name = ".PLS_approach_cf", values = eval(formals(csem)$.PLS_approach_cf)),
  max_abs_diff_vs_reference = c(cmp_ref(plsc, ref_c), list(
    reliabilities_vs_rhoA = max_abs_diff(plsc$Estimates$Reliabilities[names(ref_c$rho_A)], ref_c$rho_A),
    construct_cor = max_abs_diff(plsc$Estimates$Construct_VCV[names(TAM_BLOCKS), names(TAM_BLOCKS)], ref_c$construct_cor)
  )),
  change_vs_classic_modeA = list(
    weights_max_abs_diff = max_abs_diff(plsc$Estimates$Weight_estimates, classic$Estimates$Weight_estimates),
    loadings_max_abs_diff = max_abs_diff(plsc$Estimates$Loading_estimates, classic$Estimates$Loading_estimates),
    paths = data.frame(from = TAM_PATHS$from, to = TAM_PATHS$to,
                       classic = csem_paths_df(classic)$est, plsc = csem_paths_df(plsc)$est),
    r2 = data.frame(construct = names(classic$Estimates$R2), classic = as.numeric(classic$Estimates$R2),
                    plsc = as.numeric(plsc$Estimates$R2[names(classic$Estimates$R2)])),
    construct_scores_identical = max_abs_diff(plsc$Estimates$Construct_scores, classic$Estimates$Construct_scores),
    proxy_vs_construct_vcv_differ_in_plsc = max_abs_diff(plsc$Estimates$Proxy_VCV, plsc$Estimates$Construct_VCV),
    proxy_vs_construct_vcv_differ_in_classic = max_abs_diff(classic$Estimates$Proxy_VCV, classic$Estimates$Construct_VCV)
  )
))
rel <- assess(plsc, .quality_criterion = c("ave", "rho_C", "rho_C_weighted", "rho_T"))
write_parity(
  engine = "cSEM", variant = "plsc",
  options = c(list(.model_operator = "=~"), opts_plsc),
  paths = csem_paths_df(plsc),
  loadings = csem_block_df(plsc$Estimates$Loading_estimates),
  weights = csem_block_df(plsc$Estimates$Weight_estimates),
  r2 = vec_named(plsc$Estimates$R2),
  extra = list(
    r2adj = vec_named(plsc$Estimates$R2adj),
    iterations = plsc$Information$Weight_info$Number_iterations,
    converged = plsc$Information$Weight_info$Convergence_status,
    reliabilitiesUsedForCorrection = vec_named(plsc$Estimates$Reliabilities),
    constructCorrelations = mat_named(plsc$Estimates$Construct_VCV),
    proxyCorrelations = mat_named(plsc$Estimates$Proxy_VCV),
    ave = vec_named(rel$AVE), rhoC = vec_named(rel$RhoC), rhoA = vec_named(rel$RhoC_weighted), cronbachAlpha = vec_named(rel$RhoT),
    independentReferenceMaxAbsDiff = cmp_ref(plsc, ref_c)
  )
)

# ---- (c) Mode B and mixed models ---------------------------------------------------
tc <- try_capture(csem(d, m_comp, .tolerance = TOL, .iter_max = ITER))
ref_b <- ref_pls(d, TAM_BLOCKS, TAM_STRUCT, scheme = "path", modes = "B", tol = TOL, max_iter = ITER)
find$modeB_all <- c(status_of(tc, describe), list(
  options = list(.model_operator = "<~", .tolerance = TOL, .iter_max = ITER),
  max_abs_diff_vs_reference = cmp_ref(tc$value, ref_b),
  reference_iterations = ref_b$iterations
))

mixed_ops <- c(PU = "<~", PEOU = "<~", ATU = "=~", BI = "=~", USE = "=~")
m_mixed <- tam_model_syntax(mixed_ops)
mixed_modes <- c(PU = "B", PEOU = "B", ATU = "A", BI = "A", USE = "A")
tc1 <- try_capture(csem(d, m_mixed, .disattenuate = FALSE, .tolerance = TOL, .iter_max = ITER))
ref_m <- ref_pls(d, TAM_BLOCKS, TAM_STRUCT, scheme = "path", modes = mixed_modes, tol = TOL, max_iter = ITER)
tc2 <- try_capture(csem(d, m_mixed, .tolerance = TOL, .iter_max = ITER))
ref_mc <- ref_pls(d, TAM_BLOCKS, TAM_STRUCT, scheme = "path", modes = mixed_modes, tol = TOL, max_iter = ITER, consistent = TRUE)
tc3 <- try_capture(csem(d, m_cf, .disattenuate = FALSE, .PLS_modes = list(PU = "modeB", PEOU = "modeB"), .tolerance = TOL, .iter_max = ITER))
find$mixed <- list(
  model_operators = as.list(mixed_ops),
  classic_no_correction = c(status_of(tc1, describe), list(
    options = list(.disattenuate = FALSE), max_abs_diff_vs_reference = cmp_ref(tc1$value, ref_m))),
  plsc_for_factors_only = c(status_of(tc2, describe), list(
    options = list(.disattenuate = TRUE), max_abs_diff_vs_reference = cmp_ref(tc2$value, ref_mc))),
  named_list_PLS_modes_on_common_factors = c(status_of(tc3, describe), list(
    options = list(.disattenuate = FALSE, .PLS_modes = list(PU = "modeB", PEOU = "modeB")),
    max_abs_diff_vs_mixed_operator_model = max_abs_diff(csem_paths_df(tc3$value)$est, csem_paths_df(tc1$value)$est)))
)

# ---- (d) convergence and admissibility ------------------------------------------------
base <- csem(d, m_cf, .disattenuate = FALSE)
tc_it <- try_capture(csem(d, m_cf, .disattenuate = FALSE, .iter_max = 2, .tolerance = 1e-12))
tc_one <- try_capture(csem(d, m_cf, .disattenuate = FALSE, .iter_max = 1))
ver_ok <- verify(base)
ver_bad <- if (tc_it$ok) verify(tc_it$value) else NULL
crit <- lapply(stats::setNames(nm = eval(formals(csem)$.conv_criterion)), function(cc) {
  r <- csem(d, m_cf, .disattenuate = FALSE, .conv_criterion = cc, .tolerance = 1e-8)
  list(iterations = r$Information$Weight_info$Number_iterations, converged = r$Information$Weight_info$Convergence_status)
})
tol_runs <- lapply(c(1e-3, 1e-5, 1e-7, 1e-10, 1e-13), function(tl) {
  r <- csem(d, m_cf, .disattenuate = FALSE, .tolerance = tl, .iter_max = ITER)
  list(tolerance = tl, iterations = r$Information$Weight_info$Number_iterations,
       converged = r$Information$Weight_info$Convergence_status,
       `max_abs_path_diff_vs_tol_1e-10` = max_abs_diff(csem_paths_df(r)$est, csem_paths_df(scheme_fits$path)$est),
       `max_abs_weight_diff_vs_tol_1e-10` = max_abs_diff(r$Estimates$Weight_estimates, scheme_fits$path$Estimates$Weight_estimates))
})
find$convergence <- list(
  where = list(iterations = "res$Information$Weight_info$Number_iterations",
               converged = "res$Information$Weight_info$Convergence_status",
               modes = "res$Information$Weight_info$Modes"),
  default_run = list(tolerance = base$Information$Arguments$.tolerance, iter_max = base$Information$Arguments$.iter_max,
                     conv_criterion = base$Information$Arguments$.conv_criterion,
                     iterations = base$Information$Weight_info$Number_iterations,
                     converged = base$Information$Weight_info$Convergence_status),
  tolerance_sweep = tol_runs,
  `conv_criterion_sweep_tol_1e-8` = crit,
  iter_max_2 = status_of(tc_it, function(v) list(iterations = v$Information$Weight_info$Number_iterations,
                                                 converged = v$Information$Weight_info$Convergence_status)),
  iter_max_1_one_step_weights = status_of(tc_one, function(v) list(iterations = v$Information$Weight_info$Number_iterations,
                                                                   converged = v$Information$Weight_info$Convergence_status)),
  verify = list(
    class = class(ver_ok),
    codes_converged_model = as.list(ver_ok),
    codes_iter_max_2 = if (is.null(ver_bad)) NULL else as.list(ver_bad),
    meaning = "named logical vector; TRUE = problem detected. sum(verify(res)) == 0 means admissible.",
    printed = utils::capture.output(print(ver_ok))
  )
)

# ---- scaling conventions ----------------------------------------------------------------
S <- stats::cor(d[, colnames(base$Estimates$Indicator_VCV)])
W <- base$Estimates$Weight_estimates
sc <- base$Estimates$Construct_scores
dz <- as.data.frame(scale(d))
res_z <- csem(dz, m_cf, .disattenuate = FALSE)
find$scaling <- list(
  indicator_vcv_is_pearson_correlation = max_abs_diff(base$Estimates$Indicator_VCV, S),
  type_of_indicator_correlation = base$Information$Type_of_indicator_correlation,
  composite_variance_wSw_minus_1 = max(abs(diag(W %*% S %*% t(W)) - 1)),
  construct_scores_dim = dim(sc),
  construct_scores_var_minus_1 = max(abs(apply(sc, 2, stats::var) - 1)),
  construct_scores_mean_abs_max = max(abs(colMeans(sc))),
  scores_equal_scaled_data_times_weights = max_abs_diff(sc, scale(d[, colnames(W)]) %*% t(W)),
  stored_data_is_standardised = max(abs(apply(base$Information$Data, 2, stats::sd) - 1)),
  raw_vs_prestandardised_input_path_diff = max_abs_diff(csem_paths_df(base)$est, csem_paths_df(res_z)$est),
  all_loadings_positive = all(csem_block_df(base$Estimates$Loading_estimates)$est > 0),
  loading_equals_cor_indicator_score = max_abs_diff(
    csem_block_df(base$Estimates$Loading_estimates)$est,
    unlist(lapply(names(TAM_BLOCKS), function(k) stats::cor(d[, TAM_BLOCKS[[k]]], sc[, k])))),
  construct_order_in_object = colnames(sc),
  indicator_order_in_object = colnames(W),
  note = "cSEM reorders constructs (exogenous first, then causal order) and indicators accordingly; never index by position."
)

write_evidence("csem_pls_core", find, packages = c("cSEM", "lavaan", "jsonlite"))
