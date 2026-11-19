# Phase 0 spike - cSEM resampling and inference (task item g).
#
#   - bootstrap via csem(.resample_method = "bootstrap") and resamplecSEMResults()
#   - seed semantics and reproducibility, where the raw draws live
#   - every draw re-derived from first principles (same indices -> same estimate)
#   - .handle_inadmissibles drop / ignore / replace and how failures are counted
#   - infer(): every .quantity, alpha semantics, which need extra resampling
#   - DESIGN CHECK for chunked bootstrapping + our own quantile() percentile CI
#   - timing per 100 resamples, parallel plans, BLAS thread count
#
# Runtime: about 6-8 minutes (the BCa interval needs a 1190-run jackknife).
#
# Evidence: docs/validation/phase-0/evidence/r/csem_resampling.json

source(file.path(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "_common.R"))
suppressPackageStartupMessages(library(cSEM))

d <- load_tam()
n <- nrow(d)
m_cf <- tam_model_syntax("=~")
find <- list()
# elapsed wall-clock AND cpu seconds: the spike machine is shared with other jobs,
# so wall time alone overstates the cost.
timed <- function(expr) {
  p0 <- proc.time(); v <- expr; p1 <- proc.time() - p0
  list(value = v, seconds = p1[["elapsed"]], cpu_seconds = p1[["user.self"]] + p1[["sys.self"]])
}
draws_of <- function(res, what = "Path_estimates") res$Estimates$Estimates_resample$Estimates1[[what]]$Resampled
info_of <- function(res) res$Information$Information_resample

base <- csem(d, m_cf, .disattenuate = FALSE)

# ---- API ------------------------------------------------------------------------
find$api <- list(
  csem_resample_args = formals_of(csem)[c(".resample_method", ".resample_method2", ".R", ".R2", ".handle_inadmissibles",
                                          ".user_funs", ".eval_plan", ".seed", ".sign_change_option")],
  resamplecSEMResults_formals = formals_of(resamplecSEMResults),
  infer_formals = formals_of(infer),
  infer_quantity_values = eval(formals(infer)$.quantity),
  resampleData_formals = formals_of(resampleData)
)

# ---- reproducibility ---------------------------------------------------------------
R0 <- 60L
rng_before <- if (exists(".Random.seed", envir = globalenv())) get(".Random.seed", envir = globalenv()) else NULL
set.seed(999); invisible(runif(1)); rng_mark <- .Random.seed
a1 <- timed(csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = R0, .seed = 101))
rng_after <- .Random.seed
a2 <- csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = R0, .seed = 101)
a3 <- csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = R0, .seed = 102)
a4 <- resamplecSEMResults(base, .resample_method = "bootstrap", .R = R0, .seed = 101)
a5 <- csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = R0 / 2L, .seed = 101)
set.seed(5); n1 <- csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 10)
set.seed(5); n2 <- csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 10)
e1 <- a1$value$Estimates$Estimates_resample$Estimates1
find$reproducibility <- list(
  R = R0,
  same_seed_csem_twice_identical = identical(draws_of(a1$value), draws_of(a2)),
  same_seed_all_quantities_identical = identical(a1$value$Estimates$Estimates_resample, a2$Estimates$Estimates_resample),
  different_seed_identical = identical(draws_of(a1$value), draws_of(a3)),
  different_seed_max_abs_diff = max_abs_diff(draws_of(a1$value), draws_of(a3)),
  csem_vs_resamplecSEMResults_same_seed_identical = identical(draws_of(a1$value), draws_of(a4)),
  prefix_property_first_R_over_2_draws_identical = identical(draws_of(a1$value)[seq_len(R0 / 2L), ], draws_of(a5)),
  prefix_property_note = "draw i depends only on (.seed, i): future.apply::future_lapply(1:.R, ..., future.seed = .seed) assigns one L'Ecuyer-CMRG stream per replication index",
  global_RNG_state_untouched_by_seeded_run = identical(rng_mark, rng_after),
  seed_NULL_after_set_seed_reproducible = identical(draws_of(n1), draws_of(n2)),
  seed_NULL_recorded_seed = list(run1 = info_of(n1)$Seed, run2 = info_of(n2)$Seed),
  information_resample = info_of(a1$value),
  where_raw_draws_live = list(
    path = "res$Estimates$Estimates_resample$Estimates1$Path_estimates$Resampled  (matrix: admissible draws x parameters)",
    original = "res$Estimates$Estimates_resample$Estimates1$Path_estimates$Original",
    quantities = names(e1),
    dims = lapply(e1, function(q) dim(q$Resampled)),
    colnames = lapply(e1, function(q) colnames(q$Resampled)),
    rownames_present = !is.null(rownames(e1$Path_estimates$Resampled)),
    bookkeeping = "res$Information$Information_resample: Method, Number_of_admissibles, Number_of_observations, Number_of_runs, Seed, Handle_inadmissibles, Sign_change_option"
  ),
  seconds_for_R = a1$seconds
)

# ---- every draw re-derived from first principles ---------------------------------------
# cSEM draws row indices with sample(1:n, n, replace = TRUE) inside future_lapply(future.seed = .seed).
# Reproduce the same index sets independently and refit on them.
Rv <- 6L
idx <- future.apply::future_lapply(seq_len(Rv), function(i) sample(1:n, size = n, replace = TRUE), future.seed = 101)
refit <- t(sapply(idx, function(ix) {
  r <- csem(d[ix, ], m_cf, .disattenuate = FALSE)
  csem_paths_df(r)$est
}))
cs <- draws_of(a1$value)[seq_len(Rv), ]
cs_ordered <- cs[, paste(TAM_PATHS$to, "~", TAM_PATHS$from)]
find$draws_first_principles <- list(
  replications_checked = Rv,
  max_abs_diff_csem_draw_vs_refit_on_same_indices = max(abs(cs_ordered - refit)),
  resampling_unit = "rows (observations) with replacement, size n",
  n_unique_rows_in_first_resample = length(unique(idx[[1]])),
  conclusion = if (max(abs(cs_ordered - refit)) < 1e-10)
    "CONFIRMED: a cSEM bootstrap draw is exactly csem() on the rows sample(1:n, n, replace = TRUE) drawn from RNG stream i of seed .seed."
  else "NOT CONFIRMED: refits on independently reproduced indices differ from cSEM's draws."
)

# ---- infer() ------------------------------------------------------------------------------
P <- draws_of(a1$value)
inf_all <- timed(infer(a1$value))
ci_p <- inf_all$value$Path_estimates$CI_percentile
qcmp <- lapply(1:9, function(ty) {
  two_sided <- apply(P, 2, stats::quantile, probs = c(0.025, 0.975), type = ty, names = FALSE)
  one_each <- apply(P, 2, stats::quantile, probs = c(0.05, 0.95), type = ty, names = FALSE)
  list(type = ty, max_abs_diff_alpha_half = max(abs(two_sided - ci_p)), max_abs_diff_alpha_full = max(abs(one_each - ci_p)))
})
orig <- e1$Path_estimates$Original
bc_own <- sapply(seq_len(ncol(P)), function(j) {
  z0 <- stats::qnorm(mean(P[, j] < orig[j]))
  pr <- stats::pnorm(2 * z0 + stats::qnorm(c(0.025, 0.975)))
  stats::quantile(P[, j], probs = pr, type = 7, names = FALSE)
})
z <- stats::qnorm(0.975)
se <- apply(P, 2, stats::sd)
bias <- colMeans(P) - orig
inf_noBC <- infer(a1$value, .quantity = "CI_standard_z", .bias_corrected = FALSE)
multi_alpha <- infer(a1$value, .quantity = "CI_percentile", .alpha = c(0.01, 0.05, 0.10))
t_pct <- timed(infer(a1$value, .quantity = "CI_percentile"))
find$infer <- list(
  class = class(inf_all$value),
  top_level_names = names(inf_all$value),
  default_quantities_returned = names(inf_all$value$Path_estimates),
  ci_dimnames_alpha_0.05 = dimnames(ci_p),
  percentile_ci_path = mat_named(ci_p),
  own_quantile_vs_infer_CI_percentile = qcmp,
  alpha_semantics = "CI_percentile with .alpha = 0.05 is the central 95% interval: quantile(draws, c(alpha/2, 1 - alpha/2)) - see the type table; the help text ('alpha and 1-alpha quantiles') is misleading",
  sd_is_stats_sd_of_draws = max_abs_diff(inf_all$value$Path_estimates$sd, se),
  bias_is_mean_minus_original = max_abs_diff(inf_all$value$Path_estimates$bias, bias),
  CI_standard_z_default_is_bias_corrected = max(abs(inf_all$value$Path_estimates$CI_standard_z - rbind(orig - bias - z * se, orig - bias + z * se))),
  CI_standard_z_bias_corrected_FALSE = max(abs(inf_noBC$Path_estimates$CI_standard_z - rbind(orig - z * se, orig + z * se))),
  CI_basic_vs_2theta_minus_percentile = max(abs(inf_all$value$Path_estimates$CI_basic -
    rbind(2 * orig - apply(P, 2, stats::quantile, 0.975, names = FALSE), 2 * orig - apply(P, 2, stats::quantile, 0.025, names = FALSE)))),
  CI_bc_vs_own_bias_corrected_percentile = max(abs(inf_all$value$Path_estimates$CI_bc - bc_own)),
  multiple_alpha_dimnames = dimnames(multi_alpha$Path_estimates$CI_percentile),
  seconds_infer_all_default = inf_all$seconds,
  seconds_infer_percentile_only = t_pct$seconds
)

# BCa: needs a full jackknife (n = 1190 additional estimations)
tc_bca <- try_capture(infer(a1$value, .quantity = "CI_bca"))
find$infer$CI_bca <- status_of(tc_bca, function(v) list(
  returned = names(v$Path_estimates), dimnames = dimnames(v$Path_estimates$CI_bca), ci = mat_named(v$Path_estimates$CI_bca),
  max_abs_diff_vs_percentile = max(abs(v$Path_estimates$CI_bca - ci_p)),
  extra_resampling = "jackknife: n leave-one-out estimations are run inside infer() on every call (not cached in the object)"))
# studentized t interval: needs double bootstrap
tc_t1 <- try_capture(infer(a1$value, .quantity = "CI_t_interval"))
dbl <- try_capture(csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .resample_method2 = "bootstrap", .R = 8, .R2 = 8, .seed = 7))
tc_t2 <- if (dbl$ok) try_capture(infer(dbl$value, .quantity = "CI_t_interval")) else NULL
find$infer$CI_t_interval <- list(
  without_second_resample = status_of(tc_t1),
  double_bootstrap_R8_R2_8 = status_of(dbl, function(v) list(estimates2_class = class(v$Estimates$Estimates_resample$Estimates2),
                                                             number_of_runs2 = info_of(v)$Number_of_runs2)),
  infer_on_double_bootstrap = if (is.null(tc_t2)) NULL else status_of(tc_t2, function(v) list(returned = names(v$Path_estimates)))
)
tc_j <- try_capture(infer(base, .quantity = "CI_percentile"))
find$infer$on_object_without_resamples <- status_of(tc_j, function(v) list(returned = names(v$Path_estimates)))

# ---- summarize(): SE, t, p ---------------------------------------------------------------------
s <- summarize(a1$value)$Estimates$Path_estimates
find$summarize <- list(
  columns = names(s),
  t_stat_is_estimate_over_bootstrap_sd = max_abs_diff(s$t_stat, s$Estimate / s$Std_err),
  p_value_vs_two_sided_normal = max_abs_diff(s$p_value, 2 * stats::pnorm(-abs(s$t_stat))),
  p_value_vs_two_sided_t_df_n_minus_1 = max_abs_diff(s$p_value, 2 * stats::pt(-abs(s$t_stat), df = n - 1)),
  summarize_formals = formals_of(summarize)
)

# ---- DESIGN CHECK: chunked bootstrap --------------------------------------------------------------
S0 <- 20261119L
chunk_seeds <- S0 + 1000L * (1:5)
chunks <- lapply(chunk_seeds, function(sd) timed(csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 100, .seed = sd)))
chunk_draws <- do.call(rbind, lapply(chunks, function(ch) draws_of(ch$value)))
single <- timed(csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 500, .seed = S0))
rerun_chunk1 <- csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 100, .seed = chunk_seeds[1])
own_ci <- function(M, type = 7) apply(M, 2, stats::quantile, probs = c(0.025, 0.975), type = type, names = FALSE)
ci_single_infer <- infer(single$value, .quantity = "CI_percentile")$Path_estimates$CI_percentile
ci_single_own <- own_ci(draws_of(single$value))
ci_chunked_own <- own_ci(chunk_draws)
mc_se_of_ci_bound <- apply(draws_of(single$value), 2, stats::sd) * sqrt(0.025 * 0.975 / 500) / stats::dnorm(stats::qnorm(0.025))
find$chunked_design <- list(
  chunk_seeds = chunk_seeds,
  i_single_chunk_reproducible = identical(draws_of(chunks[[1]]$value), draws_of(rerun_chunk1)),
  ii_own_quantile_type7_vs_infer_on_same_500_draws = max(abs(ci_single_own - ci_single_infer)),
  iii_seconds_per_100_resamples_sequential = sapply(chunks, function(ch) ch$seconds),
  seconds_single_run_500 = single$seconds,
  concatenated_dim = dim(chunk_draws),
  duplicated_draw_rows_across_chunks = sum(duplicated(chunk_draws)),
  admissible_per_chunk = sapply(chunks, function(ch) info_of(ch$value)$Number_of_admissibles),
  ci_chunked_5x100 = mat_named(`dimnames<-`(ci_chunked_own, list(c("2.5%", "97.5%"), colnames(chunk_draws)))),
  ci_single_500 = mat_named(`dimnames<-`(ci_single_own, list(c("2.5%", "97.5%"), colnames(chunk_draws)))),
  max_abs_diff_chunked_vs_single_ci = max(abs(ci_chunked_own - ci_single_own)),
  approx_monte_carlo_se_of_a_ci_bound_at_B500 = as.list(mc_se_of_ci_bound),
  sd_chunked_vs_single = list(chunked = as.list(apply(chunk_draws, 2, stats::sd)), single = as.list(apply(draws_of(single$value), 2, stats::sd))),
  cpu_seconds_per_100_resamples_sequential = sapply(chunks, function(ch) ch$cpu_seconds),
  cpu_seconds_single_run_500 = single$cpu_seconds
)
local({
  cd <- find$chunked_design
  mc <- unlist(cd$approx_monte_carlo_se_of_a_ci_bound_at_B500)
  find$chunked_design$computed_verdicts <<- list(
    chunk_reproducible = cd$i_single_chunk_reproducible,
    own_type7_equals_infer = cd$ii_own_quantile_type7_vs_infer_on_same_500_draws < 1e-12,
    no_duplicate_draws_across_chunks = cd$duplicated_draw_rows_across_chunks == 0,
    chunked_vs_single_ci_diff_within_4_mc_se = cd$max_abs_diff_chunked_vs_single_ci < 4 * max(mc)
  )
})

# ---- independent bootstrap loop (own sampling, plain csem()) -----------------------------------------
set.seed(31337)
own_loop <- timed(t(sapply(1:100, function(i) {
  r <- csem(d[sample.int(n, n, replace = TRUE), ], m_cf, .disattenuate = FALSE)
  csem_paths_df(r)$est
})))
find$own_bootstrap_loop <- list(
  seconds_per_100 = own_loop$seconds,
  sd_own_loop_100 = as.list(stats::setNames(apply(own_loop$value, 2, stats::sd), paste(TAM_PATHS$to, "~", TAM_PATHS$from))),
  sd_csem_500 = as.list(apply(draws_of(single$value), 2, stats::sd)[paste(TAM_PATHS$to, "~", TAM_PATHS$from)]),
  note = "A hand-written loop around csem() gives the same sampling distribution; cSEM's resampler additionally runs summarize()/verify()/effects per draw."
)
plsc100 <- timed(csem(d, m_cf, .resample_method = "bootstrap", .R = 100, .seed = 1))
find$timing_plsc_seconds_per_100 <- plsc100$seconds
find$plsc_admissible_of_100 <- info_of(plsc100$value)$Number_of_admissibles

# ---- parallel plans ---------------------------------------------------------------------------------
par_run <- function(plan) {
  tc <- try_capture(csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 200, .seed = 77, .eval_plan = plan))
  status_of(tc, function(v) list(draws = dim(draws_of(v)), .digest = digest::digest(draws_of(v))))
}
seq200 <- par_run("sequential")
ms200 <- par_run("multisession")
mc200 <- par_run("multicore")
find$parallel <- list(
  eval_plan_values = eval(formals(csem)$.eval_plan),
  cores_detected = parallel::detectCores(),
  future_available_cores = as.integer(future::availableCores()),
  R = 200,
  sequential = seq200, multisession = ms200, multicore = mc200,
  multisession_identical_to_sequential = isTRUE(ms200$ok) && identical(ms200$result$.digest, seq200$result$.digest),
  multicore_identical_to_sequential = isTRUE(mc200$ok) && identical(mc200$result$.digest, seq200$result$.digest),
  plan_after_call = class(future::plan())[1],
  note = "cSEM calls future::plan() itself; worker count is all available cores unless options(future.workers / mc.cores) or env R_FUTURE_AVAILABLECORES_FALLBACK etc. restrict it."
)

# ---- inadmissible results -------------------------------------------------------------------------------
# A small subsample with PLSc produces Heywood-type results (|loading| > 1, reliability > 1) in some resamples.
set.seed(4)
small <- d[sample.int(n, 45), ]
small_fit <- try_capture(csem(small, m_cf))
inad <- lapply(stats::setNames(nm = c("drop", "ignore", "replace")), function(h) {
  tc <- try_capture(csem(small, m_cf, .resample_method = "bootstrap", .R = 100, .seed = 3, .handle_inadmissibles = h))
  status_of(tc, function(v) list(
    number_of_runs = info_of(v)$Number_of_runs, number_of_admissibles = info_of(v)$Number_of_admissibles,
    rows_in_draw_matrix = nrow(draws_of(v)), handle = info_of(v)$Handle_inadmissibles,
    max_abs_loading_draw = max(abs(draws_of(v, "Loading_estimates")))))
})
find$inadmissibles <- list(
  setup = "random subsample n = 45 of tam-v1, PLSc ('=~', default), .R = 100, .seed = 3",
  original_fit_verify = if (small_fit$ok) as.list(verify(small_fit$value)) else small_fit$error,
  by_option = inad,
  how_decided = "each replication is checked with verify(); sum(verify(.)) != 0 => inadmissible",
  replace_uses_seed_plus_1 = "resamplecSEMResultsCore(): replacements are drawn with .seed + 1, .seed + 2, ... - so with 'replace' the extra draws of seed S coincide with the first draws of seed S + 1. Never combine 'replace' with consecutive chunk seeds."
)
dr <- try_capture(csem(small, m_cf, .resample_method = "bootstrap", .R = 100, .seed = 3, .handle_inadmissibles = "replace"))
nx <- try_capture(csem(small, m_cf, .resample_method = "bootstrap", .R = 100, .seed = 4, .handle_inadmissibles = "drop"))
if (dr$ok && nx$ok) {
  A <- draws_of(dr$value); B <- draws_of(nx$value)
  keyA <- apply(round(A, 12), 1, paste, collapse = "|"); keyB <- apply(round(B, 12), 1, paste, collapse = "|")
  find$inadmissibles$replace_seed3_rows_also_in_drop_seed4 <- sum(keyA %in% keyB)
}
# a replication that throws an error (zero-variance indicator in the resample)
tiny <- d[c(1:6), ]
tiny$USE1[1:5] <- 4; tiny$USE1[6] <- 7                      # constant in most resamples
tiny_big <- rbind(tiny, tiny)
err_run <- try_capture(csem(tiny_big, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 60, .seed = 1))
find$replication_error <- c(
  list(setup = "12-row data set where one indicator is constant in many bootstrap samples"),
  status_of(err_run, function(v) list(number_of_runs = info_of(v)$Number_of_runs, number_of_admissibles = info_of(v)$Number_of_admissibles))
)

# ---- sign change options and user functions ------------------------------------------------------------------
# On full tam-v1 every loading is far from zero, so sign flips cannot occur there.
# To exercise the options we use a weak block: a small subsample (n = 40) where the
# USE block is made deliberately weak by replacing USE3/USE4 with noise.
sign_opts <- eval(formals(csem)$.sign_change_option)
set.seed(12)
weak <- d[sample.int(n, 40), ]
weak$USE3 <- sample(1:7, 40, replace = TRUE); weak$USE4 <- sample(1:7, 40, replace = TRUE)
weak_fit <- csem(weak, m_cf, .disattenuate = FALSE)
sign_runs <- lapply(stats::setNames(nm = sign_opts), function(o) {
  try_capture(csem(weak, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 100, .seed = 9,
                   .sign_change_option = o, .handle_inadmissibles = "ignore"))
})
w0 <- weak_fit$Estimates$Weight_estimates
flip_count <- function(v) {
  e <- v$Estimates$Estimates_resample$Estimates1$Weight_estimates
  sum(apply(sign(e$Resampled), 1, function(r) any(r != sign(e$Original))))
}
find$sign_change_option <- list(
  values = sign_opts,
  setup = "n = 40 random subsample, USE3/USE4 replaced by uniform noise 1..7 (weak block), classic Mode A, .R = 100, .seed = 9, .handle_inadmissibles = 'ignore'",
  original_weights_USE = vec_named(w0["USE", TAM_BLOCKS$USE]),
  by_option = lapply(sign_runs, function(tc) status_of(tc, function(v) list(
    recorded = info_of(v)$Sign_change_option, admissible = info_of(v)$Number_of_admissibles,
    draws = nrow(draws_of(v)),
    draws_with_any_weight_sign_differing_from_original = flip_count(v),
    negative_loading_draws = sum(draws_of(v, "Loading_estimates") < 0),
    sd_USE_paths = apply(draws_of(v), 2, stats::sd)[["USE ~ BI"]]))),
  identical_to_none = lapply(sign_runs, function(tc) if (tc$ok && sign_runs$none$ok)
    identical(draws_of(tc$value), draws_of(sign_runs$none$value)) else NULL),
  applies_only_when = "source: resamplecSEMResultsCore applies the option only if .approach_weights == 'PLS-PM'; the reference is the sign of the ORIGINAL weight estimates"
)
# .dominant_indicators: a csem() argument (not a resampling argument). Every replication
# is a full csem() call with the original arguments, so it is applied per draw.
dom <- list(PEOU = "EOU1", PU = "USEF1", ATU = "ATT1", BI = "BI1", USE = "USE1")
dom_fit <- try_capture(csem(weak, m_cf, .disattenuate = FALSE, .dominant_indicators = dom))
dom_boot <- try_capture(csem(weak, m_cf, .disattenuate = FALSE, .dominant_indicators = dom, .resample_method = "bootstrap",
                             .R = 100, .seed = 9, .handle_inadmissibles = "ignore"))
dom_neg <- try_capture(csem(weak, m_cf, .disattenuate = FALSE, .dominant_indicators = list(USE = "USE3")))
find$dominant_indicators <- list(
  argument = ".dominant_indicators = list(<construct> = '<indicator>'): flips the construct sign so the dominant indicator's weight/loading is positive",
  default = formals_of(csem)$.dominant_indicators,
  point_estimate = status_of(dom_fit, function(v) list(
    max_abs_diff_paths_vs_no_dominant = max_abs_diff(csem_paths_df(v)$est, csem_paths_df(weak_fit)$est),
    loadings_USE = vec_named(v$Estimates$Loading_estimates["USE", TAM_BLOCKS$USE]))),
  bootstrap = status_of(dom_boot, function(v) list(
    draws = nrow(draws_of(v)),
    loading_draw_colnames_head = utils::head(colnames(draws_of(v, "Loading_estimates")), 3),
    draws_with_negative_dominant_loading = {
      L <- draws_of(v, "Loading_estimates"); cols <- intersect(paste0(names(dom), " =~ ", unlist(dom)), colnames(L))
      if (length(cols)) sum(L[, cols] < 0) else NULL
    },
    draws_with_any_weight_sign_differing_from_original = flip_count(v),
    identical_to_none = if (sign_runs$none$ok) identical(draws_of(v), draws_of(sign_runs$none$value)) else NULL)),
  dominant_is_noise_indicator_USE3 = status_of(dom_neg, function(v) list(
    loadings_USE = vec_named(v$Estimates$Loading_estimates["USE", TAM_BLOCKS$USE]),
    path_USE_BI = v$Estimates$Path_estimates["USE", "BI"]))
)
uf <- try_capture(csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 20, .seed = 9,
                       .user_funs = list(r2 = function(.object) .object$Estimates$R2,
                                         htmt = function(.object) { h <- calculateHTMT(.object, .absolute = FALSE)$htmts; h[lower.tri(h)] })))
find$user_funs <- status_of(uf, function(v) {
  e <- v$Estimates$Estimates_resample$Estimates1
  list(quantities = names(e), r2_dim = dim(e$r2$Resampled), r2_colnames = colnames(e$r2$Resampled),
       r2_original = as.list(e$r2$Original), htmt_dim = dim(e$htmt$Resampled))
})
jk <- try_capture(resamplecSEMResults(csem(d[1:120, ], m_cf, .disattenuate = FALSE), .resample_method = "jackknife"))
find$jackknife_smoke <- status_of(jk, function(v) list(setup = "first 120 rows", method = info_of(v)$Method, runs = info_of(v)$Number_of_runs,
                                                       draws = dim(draws_of(v))))

# ---- BLAS / OpenMP thread count and bootstrap speed -------------------------------------------------------------
bench <- tempfile(fileext = ".R")
writeLines(c(
  "suppressPackageStartupMessages(library(cSEM))",
  sprintf("d <- utils::read.table(%s, header = TRUE, sep = ';')", deparse(TAM_DATA)),
  sprintf("m <- %s", deparse(m_cf)),
  "t0 <- proc.time()[['elapsed']]",
  "r <- csem(d, m, .disattenuate = FALSE, .resample_method = 'bootstrap', .R = 100, .seed = 1)",
  "cat(proc.time()[['elapsed']] - t0)"
), bench)
thread_bench <- lapply(stats::setNames(nm = c("1", "8")), function(th) {
  out <- suppressWarnings(system2(file.path(R.home("bin"), "Rscript"), bench, stdout = TRUE, stderr = FALSE,
                                  env = c(paste0("OMP_NUM_THREADS=", th)), timeout = 300))
  v <- suppressWarnings(as.numeric(utils::tail(out, 1)))
  if (length(v) == 0 || is.na(v)) NULL else v
})
find$threads <- list(
  OMP_NUM_THREADS_in_this_process = Sys.getenv("OMP_NUM_THREADS"),
  seconds_per_100_resamples_by_OMP_NUM_THREADS = thread_bench,
  note = "services/r-engine/bin/rscript defaults OMP_NUM_THREADS to 1"
)

write_evidence("csem_resampling", find, packages = c("cSEM", "future", "future.apply"))
