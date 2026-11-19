# Phase 0 spike - lavaan CB-SEM / CFA on tam-v1 (task item 7).
#
# Verification here is by ANALYTIC IDENTITY on lavaan's own fitted objects (chi-square
# = N * F_ML recomputed from the implied and sample covariance matrices, fit indices
# recomputed from chi-square/df, AIC/BIC from logl, := equals the product of the
# labelled estimates with a hand-computed delta-method SE, marker vs std.lv equivalence,
# residual correlations recomputed, an observed-variable regression equal to OLS). The
# parameter estimates of the latent model themselves are NOT checked against a second
# independent ML implementation (seminr's CB-SEM is a lavaan wrapper; see seminr.json).
#
# Evidence: docs/validation/phase-0/evidence/r/lavaan.json
#           docs/validation/phase-0/evidence/r/parity_lavaan_sem-ml.json

source(file.path(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "_common.R"))
suppressPackageStartupMessages(library(lavaan))

d <- load_tam()
N <- nrow(d)
cons <- names(TAM_BLOCKS)
ind_all <- unlist(TAM_BLOCKS, use.names = FALSE)
m_cfa <- tam_model_syntax("=~", structural = FALSE)
m_sem <- tam_model_syntax("=~")
find <- list()
fm_keep <- c("npar", "chisq", "df", "pvalue", "chisq.scaled", "df.scaled", "pvalue.scaled", "chisq.scaling.factor",
             "baseline.chisq", "baseline.df", "cfi", "tli", "cfi.scaled", "tli.scaled", "cfi.robust", "tli.robust",
             "rmsea", "rmsea.ci.lower", "rmsea.ci.upper", "rmsea.pvalue", "rmsea.scaled", "rmsea.ci.lower.scaled",
             "rmsea.ci.upper.scaled", "rmsea.robust", "rmsea.ci.lower.robust", "rmsea.ci.upper.robust",
             "srmr", "srmr_bentler", "aic", "bic", "bic2", "logl", "ntotal")
fm_of <- function(fit) { f <- fitMeasures(fit); list(names_returned = names(f), selected = as.list(f[intersect(fm_keep, names(f))])) }

find$api <- list(
  version = pkg_ver("lavaan"),
  parameterEstimates = formals_of(parameterEstimates),
  standardizedSolution = formals_of(standardizedSolution),
  bootstrapLavaan = formals_of(bootstrapLavaan),
  modindices_args = names(formals(modindices)),
  option_names = names(lavOptions()),
  renamed_arguments_note = "lavaan 0.7 uses snake_case argument names in several functions: parameterEstimates(boot_ci_type =), standardizedSolution(type = 'std_all'), bootstrapLavaan(r =, fun =). See old_argument_names below for whether the 0.6 names still work."
)
fit_ml <- sem(m_sem, data = d, estimator = "ML")
find$api$old_argument_names <- list(
  standardizedSolution_type_std.all = status_of(try_capture(standardizedSolution(fit_ml, type = "std.all")), function(v) list(rows = nrow(v))),
  parameterEstimates_boot.ci.type = status_of(try_capture(parameterEstimates(fit_ml, boot.ci.type = "perc")), function(v) list(rows = nrow(v)))
)

# ---- 1. estimators: CFA and SEM, ML / MLR / MLM ---------------------------------------------------
ests <- c("ML", "MLR", "MLM")
fits <- list()
for (mod in c("cfa", "sem")) for (e in ests) {
  tc <- try_capture(if (mod == "cfa") cfa(m_cfa, data = d, estimator = e) else sem(m_sem, data = d, estimator = e))
  fits[[paste(mod, e, sep = "_")]] <- tc
}
find$estimators <- lapply(fits, function(tc) status_of(tc, function(v) c(list(
  converged = lavInspect(v, "converged"), post_check = lavInspect(v, "post.check"),
  iterations = lavInspect(v, "iterations"), se = lavInspect(v, "options")$se, test = lavInspect(v, "options")$test),
  fm_of(v))))
find$estimators$point_estimates_ML_vs_MLR_vs_MLM <- list(
  sem_ML_vs_MLR = max_abs_diff(coef(fits$sem_ML$value), coef(fits$sem_MLR$value)),
  sem_ML_vs_MLM = max_abs_diff(coef(fits$sem_ML$value), coef(fits$sem_MLM$value)),
  note = "MLR / MLM change SEs and the test statistic, not the point estimates"
)

# ---- 2. identity checks on the ML SEM fit --------------------------------------------------------------
S <- lavInspect(fit_ml, "sampstat")$cov
Sig <- lavInspect(fit_ml, "implied")$cov
p <- ncol(S)
F_ml <- log(det(Sig)) - log(det(S)) + sum(diag(S %*% solve(Sig))) - p
fm <- fitMeasures(fit_ml)
chi <- fm[["chisq"]]; df <- fm[["df"]]; chib <- fm[["baseline.chisq"]]; dfb <- fm[["baseline.df"]]
Sc <- stats::cov2cor(S); Sigc <- stats::cov2cor(Sig)
srmr_bentler <- sqrt(mean(((S - Sig) / sqrt(outer(diag(S), diag(S))))[lower.tri(S, diag = TRUE)]^2))
Scov_unbiased <- stats::cov(d[, rownames(S)])
find$identities_sem_ML <- list(
  sample_cov_divisor_is_N = max_abs_diff(S, Scov_unbiased * (N - 1) / N),
  chisq_vs_N_times_FML = abs(chi - N * F_ml),
  chisq_vs_N_minus_1_times_FML = abs(chi - (N - 1) * F_ml),
  df_vs_moments_minus_npar = abs(df - (p * (p + 1) / 2 - fm[["npar"]])),
  pvalue_vs_pchisq = abs(fm[["pvalue"]] - stats::pchisq(chi, df, lower.tail = FALSE)),
  cfi_vs_formula = abs(fm[["cfi"]] - (1 - max(chi - df, 0) / max(chib - dfb, chi - df, 0))),
  tli_vs_formula = abs(fm[["tli"]] - ((chib / dfb - chi / df) / (chib / dfb - 1))),
  rmsea_vs_formula_N = abs(fm[["rmsea"]] - sqrt(max(chi - df, 0) / (df * N))),
  rmsea_vs_formula_N_minus_1 = abs(fm[["rmsea"]] - sqrt(max(chi - df, 0) / (df * (N - 1)))),
  srmr_vs_bentler_formula_incl_diag = abs(fm[["srmr"]] - srmr_bentler),
  aic_vs_minus2logl_plus_2npar = abs(fm[["aic"]] - (-2 * fm[["logl"]] + 2 * fm[["npar"]])),
  bic_vs_minus2logl_plus_logN_npar = abs(fm[["bic"]] - (-2 * fm[["logl"]] + log(N) * fm[["npar"]])),
  logl_vs_normal_loglik = abs(fm[["logl"]] - (-N / 2 * (p * log(2 * pi) + log(det(Sig)) + sum(diag(S %*% solve(Sig)))))),
  residuals_cor_vs_cov2cor_difference = max_abs_diff(residuals(fit_ml, type = "cor")$cov, Sc - Sigc),
  latent_cor_CFA_cor_lv_vs_standardizedSolution_covariances = {
    fc <- fits$cfa_ML$value; L <- lavInspect(fc, "cor.lv"); ss <- standardizedSolution(fc)
    lv <- ss[ss$op == "~~" & ss$lhs %in% cons & ss$rhs %in% cons & ss$lhs != ss$rhs, ]
    list(n_pairs = nrow(lv), max_abs_diff = max(abs(mapply(function(a, b) L[a, b], lv$lhs, lv$rhs) - lv$est.std)))
  },
  cor_lv_matrix = mat_named(lavInspect(fit_ml, "cor.lv"))
)
# observed-variable regression: ML estimate == OLS (independent: stats::lm)
dd <- d; dd$PUs <- rowMeans(d[, TAM_BLOCKS$PU]); dd$ATUs <- rowMeans(d[, TAM_BLOCKS$ATU]); dd$BIs <- rowMeans(d[, TAM_BLOCKS$BI])
reg <- sem("BIs ~ PUs + ATUs", data = dd)
ols <- stats::lm(BIs ~ PUs + ATUs, data = dd)
pe_reg <- parameterEstimates(reg)
find$identities_sem_ML$observed_regression_ML_vs_OLS <- list(
  slopes = max_abs_diff(pe_reg$est[pe_reg$op == "~"], stats::coef(ols)[c("PUs", "ATUs")]),
  residual_variance_ML_is_RSS_over_N = abs(pe_reg$est[pe_reg$op == "~~" & pe_reg$lhs == "BIs"] - sum(stats::resid(ols)^2) / N),
  se_ML_vs_OLS_se_times_sqrt_N_minus_k_over_N = max_abs_diff(pe_reg$se[pe_reg$op == "~"], summary(ols)$coefficients[c("PUs", "ATUs"), 2] * sqrt((N - 3) / N))
)

# ---- 3. scale identification: marker vs std.lv ----------------------------------------------------------------
fit_stdlv <- sem(m_sem, data = d, std.lv = TRUE)
ss_m <- standardizedSolution(fit_ml); ss_s <- standardizedSolution(fit_stdlv)
k <- function(s) paste(s$lhs, s$op, s$rhs)
pe_m <- parameterEstimates(fit_ml)
find$identification <- list(
  default = "marker: first loading of each factor fixed to 1 (auto.fix.first = TRUE)",
  first_loadings_fixed = pe_m$est[pe_m$op == "=~" & pe_m$rhs %in% sapply(TAM_BLOCKS, `[`, 1)],
  std_lv_TRUE = "factor variances (exogenous) / residual variances of endogenous factors fixed to 1, all loadings free",
  chisq_marker_vs_stdlv = abs(fitMeasures(fit_ml)[["chisq"]] - fitMeasures(fit_stdlv)[["chisq"]]),
  std_all_marker_vs_stdlv = max(abs(ss_m$est.std - ss_s$est.std[match(k(ss_m), k(ss_s))])),
  stdlv_endogenous_latent_variance_note = "with std.lv = TRUE lavaan fixes the RESIDUAL variance of endogenous latents to 1, so unstandardised paths differ from the marker solution; standardised ones agree"
)

# ---- 4. parameter tables -------------------------------------------------------------------------------------------
pe <- parameterEstimates(fit_ml, ci = TRUE, level = 0.95, standardized = TRUE, rsquare = TRUE)
find$parameterEstimates <- list(
  columns = names(pe),
  ci_is_wald = max(abs(pe$ci.lower - (pe$est - stats::qnorm(0.975) * pe$se)), na.rm = TRUE),
  rows_by_op = as.list(table(pe$op)),
  structural = df_rows(pe[pe$op == "~", c("lhs", "rhs", "est", "se", "z", "pvalue", "ci.lower", "ci.upper", "std.all")]),
  standardizedSolution_columns = names(standardizedSolution(fit_ml)),
  r2 = as.list(lavInspect(fit_ml, "r2"))
)

# ---- 5. defined parameter (indirect effect) -------------------------------------------------------------------------
m_ind <- paste(tam_model_syntax("=~", structural = FALSE),
               "PU ~ PEOU", "ATU ~ PEOU + a*PU", "BI ~ PU + b*ATU", "USE ~ BI",
               "ind_PU_ATU_BI := a*b", "tot_PU_BI := a*b + c", sep = "\n")
m_ind <- sub("BI ~ PU + b*ATU", "BI ~ c*PU + b*ATU", m_ind, fixed = TRUE)
fit_ind <- sem(m_ind, data = d)
pei <- parameterEstimates(fit_ind)
V <- lavInspect(fit_ind, "vcov")
a <- pei$est[pei$label == "a"][1]; b <- pei$est[pei$label == "b"][1]
g <- c(b, a)
se_delta <- sqrt(drop(t(g) %*% V[c("a", "b"), c("a", "b")] %*% g))
find$defined_parameter <- list(
  model_lines = c("ATU ~ PEOU + a*PU", "BI ~ c*PU + b*ATU", "ind_PU_ATU_BI := a*b", "tot_PU_BI := a*b + c"),
  rows = df_rows(pei[pei$op == ":=", c("lhs", "rhs", "est", "se", "z", "pvalue", "ci.lower", "ci.upper")]),
  est_vs_product = abs(pei$est[pei$lhs == "ind_PU_ATU_BI"] - a * b),
  se_vs_hand_delta_method = abs(pei$se[pei$lhs == "ind_PU_ATU_BI"] - se_delta),
  vcov_rownames_use_labels = all(c("a", "b") %in% rownames(V))
)

# ---- 6. bootstrap ---------------------------------------------------------------------------------------------------------
R_B <- 50L
bt <- function(seed) try_capture(sem(m_ind, data = d, se = "bootstrap", bootstrap = R_B, iseed = seed))
b1 <- bt(1); b2 <- bt(1); b3 <- bt(2)
bdraw <- function(f) lavInspect(f, "boot")
ci_types <- c("norm", "basic", "perc", "bca.simple", "bca")
find$bootstrap <- list(
  call = sprintf("sem(model, data, se = 'bootstrap', bootstrap = %d, iseed = <seed>)", R_B),
  run = status_of(b1, function(v) list(boot_dim = dim(bdraw(v)), seconds_per_R = NULL,
                                      error_idx_attr = attr(bdraw(v), "error.idx"), nonadmissible_attr = attr(bdraw(v), "nonadmissible"),
                                      attributes = names(attributes(bdraw(v))))),
  seconds = b1$seconds,
  same_iseed_identical = if (b1$ok && b2$ok) identical(bdraw(b1$value), bdraw(b2$value)) else NULL,
  different_iseed_identical = if (b1$ok && b3$ok) identical(bdraw(b1$value), bdraw(b3$value)) else NULL,
  se_vs_sd_of_draws = if (b1$ok) { B <- bdraw(b1$value); pt <- parTable(b1$value)
    se_free <- pt$se[pt$free > 0][order(pt$free[pt$free > 0])]
    list(columns_are_free_parameters = ncol(B) == length(se_free),
         sd_n_minus_1 = max(abs(se_free - apply(B, 2, stats::sd))),
         sd_divisor_R = max(abs(se_free - apply(B, 2, stats::sd) * sqrt((nrow(B) - 1) / nrow(B))))) } else NULL,
  boot_ci_types = lapply(stats::setNames(nm = ci_types), function(ty) status_of(
    try_capture(parameterEstimates(b1$value, boot_ci_type = ty)), function(v) {
      r <- v[v$lhs == "ind_PU_ATU_BI", c("est", "ci.lower", "ci.upper")]; as.list(r) })),
  perc_vs_own_quantile_free_parameter_a = if (b1$ok) {
    pb <- parameterEstimates(b1$value, boot_ci_type = "perc"); B <- bdraw(b1$value)
    j <- which(parTable(b1$value)$label == "a"); col <- parTable(b1$value)$free[j]
    lapply(stats::setNames(1:9, paste0("type", 1:9)), function(ty)
      max(abs(c(pb$ci.lower[pb$label == "a"], pb$ci.upper[pb$label == "a"]) - stats::quantile(B[, col], c(0.025, 0.975), type = ty, names = FALSE))))
  } else NULL,
  perc_vs_boot_norm_inter_free_parameter_a = if (b1$ok) {
    # boot::norm.inter (Davison & Hinkley 5.8): interpolation on the normal-quantile scale between order statistics
    norm_inter <- function(t, alpha) {
      t <- sort(t[is.finite(t)]); R <- length(t)
      sapply(alpha, function(al) {
        rk <- (R + 1) * al; k <- trunc(rk)
        if (k == rk) return(t[k]); if (k == 0) return(t[1]); if (k == R) return(t[R])
        t[k] + (stats::qnorm(al) - stats::qnorm(k / (R + 1))) / (stats::qnorm((k + 1) / (R + 1)) - stats::qnorm(k / (R + 1))) * (t[k + 1] - t[k])
      })
    }
    pb <- parameterEstimates(b1$value, boot_ci_type = "perc"); B <- bdraw(b1$value)
    col <- parTable(b1$value)$free[parTable(b1$value)$label == "a"]
    max(abs(c(pb$ci.lower[pb$label == "a"], pb$ci.upper[pb$label == "a"]) - norm_inter(B[, col], c(0.025, 0.975))))
  } else NULL,
  perc_vs_own_quantile_defined_a_times_b = if (b1$ok) {
    pb <- parameterEstimates(b1$value, boot_ci_type = "perc"); B <- bdraw(b1$value)
    # defined parameters are not columns of the draw matrix: recompute a*b per draw
    pt <- parTable(b1$value); ab <- B[, pt$free[pt$label == "a"]] * B[, pt$free[pt$label == "b"]]
    lapply(stats::setNames(1:9, paste0("type", 1:9)), function(ty)
      max(abs(c(pb$ci.lower[pb$lhs == "ind_PU_ATU_BI"], pb$ci.upper[pb$lhs == "ind_PU_ATU_BI"]) - stats::quantile(ab, c(0.025, 0.975), type = ty, names = FALSE))))
  } else NULL
)
bl <- function(seed) try_capture(bootstrapLavaan(fit_ml, r = 20, fun = "coef", iseed = seed))
bl1 <- bl(7); bl2 <- bl(7)
find$bootstrapLavaan <- list(
  call = "bootstrapLavaan(fit, r = 20, fun = 'coef', iseed = 7)",
  run = status_of(bl1, function(v) list(dim = dim(v), attributes = names(attributes(v)))),
  same_iseed_identical = if (bl1$ok && bl2$ok) identical(bl1$value, bl2$value) else NULL,
  old_argument_names_R_FUN = status_of(try_capture(bootstrapLavaan(fit_ml, R = 5, FUN = "coef", iseed = 7)), function(v) list(dim = dim(v)))
)

# ---- 7. ordinal route -----------------------------------------------------------------------------------------------------
ord <- lapply(stats::setNames(nm = c("WLSMV", "DWLS")), function(e) {
  tc <- try_capture(cfa(m_cfa, data = d, ordered = ind_all, estimator = e))
  status_of(tc, function(v) c(list(converged = lavInspect(v, "converged"), n_thresholds = sum(parameterEstimates(v)$op == "|"),
                                   parameterization = lavInspect(v, "options")$parameterization,
                                   se = lavInspect(v, "options")$se, test = lavInspect(v, "options")$test,
                                   categories_per_item = as.list(sapply(d[, ind_all], function(x) length(unique(x))))), fm_of(v)))
})
ord_true <- try_capture(cfa(m_cfa, data = d, ordered = TRUE, estimator = "WLSMV"))
ord_sem <- try_capture(sem(m_sem, data = d, ordered = ind_all, estimator = "WLSMV"))
find$ordinal <- list(
  cfa = ord,
  ordered_TRUE_shortcut = status_of(ord_true, function(v) list(n_thresholds = sum(parameterEstimates(v)$op == "|"))),
  sem_WLSMV = status_of(ord_sem, function(v) list(converged = lavInspect(v, "converged"), fm = fm_of(v)$selected)),
  ml_with_ordered = status_of(try_capture(cfa(m_cfa, data = d, ordered = ind_all, estimator = "ML")))
)

# ---- 8. missing data: FIML ------------------------------------------------------------------------------------------------
set.seed(77)
dn <- d
for (v in c("USEF2", "ATT3", "BI1", "USE4")) dn[[v]][sample.int(N, 30)] <- NA
fiml <- lapply(stats::setNames(nm = c("ML", "MLR")), function(e) status_of(try_capture(sem(m_sem, data = dn, missing = "fiml", estimator = e)),
  function(v) list(nobs = lavInspect(v, "nobs"), missing_option = lavInspect(v, "options")$missing,
                   n_patterns = length(lavInspect(v, "patterns")) , fm = fm_of(v)$selected)))
lw <- try_capture(sem(m_sem, data = dn))
find$missing <- list(
  setup = "30 NA injected in each of USEF2, ATT3, BI1, USE4 (set.seed(77))",
  incomplete_rows = sum(!stats::complete.cases(dn)),
  default_listwise = status_of(lw, function(v) list(nobs = lavInspect(v, "nobs"), norig = lavInspect(v, "norig"), missing = lavInspect(v, "options")$missing)),
  fiml = fiml,
  fiml_with_MLM = status_of(try_capture(sem(m_sem, data = dn, missing = "fiml", estimator = "MLM"))),
  fiml_with_WLSMV_ordered = status_of(try_capture(cfa(m_cfa, data = dn, missing = "fiml", ordered = ind_all, estimator = "WLSMV"))),
  pairwise_with_WLSMV_ordered = status_of(try_capture(cfa(m_cfa, data = dn, missing = "pairwise", ordered = ind_all, estimator = "WLSMV")),
                                          function(v) list(nobs = lavInspect(v, "nobs")))
)

# ---- 9. modification indices ------------------------------------------------------------------------------------------------
mi <- modindices(fit_ml, sort = TRUE, maximum.number = 8)
find$modindices <- list(columns = names(mi), top = df_rows(mi[, intersect(c("lhs", "op", "rhs", "mi", "epc", "sepc.all"), names(mi))]))

# ---- 10. pathological models: how problems surface -----------------------------------------------------------------------------
diag_of <- function(tc) {
  out <- status_of(tc)
  if (tc$ok) {
    v <- tc$value
    pe_ <- parameterEstimates(v)
    out$diagnostics <- list(
      converged = lavInspect(v, "converged"),
      post_check = suppressWarnings(lavInspect(v, "post.check")),
      negative_variances = df_rows(pe_[pe_$op == "~~" & pe_$lhs == pe_$rhs & pe_$est < 0, c("lhs", "est")]),
      vcov_ok = !anyNA(tryCatch(lavInspect(v, "vcov"), error = function(e) NA)),
      fit_chisq = tryCatch(fitMeasures(v, "chisq")[[1]], error = function(e) conditionMessage(e)),
      df = tryCatch(fitMeasures(v, "df")[[1]], error = function(e) conditionMessage(e))
    )
  }
  out
}
set.seed(5)
small <- d[sample.int(N, 40), ]
small$BI1n <- small$BI1 + stats::rnorm(40, sd = 0.05)
bad <- list(
  heywood_near_duplicate_indicator_n40 = try_capture(cfa("BI =~ BI1 + BI1n + BI2 + BI3\nATU =~ ATT1 + ATT2 + ATT3", data = small)),
  npd_exact_duplicate_column = try_capture({ dd2 <- d; dd2$BI1dup <- dd2$BI1; cfa("BI =~ BI1 + BI1dup + BI2 + BI3", data = dd2) }),
  nonconvergence_iter_max_3 = try_capture(sem(m_sem, data = d, control = list(iter.max = 3))),
  not_identified_two_indicator_single_factor = try_capture(cfa("F =~ BI1 + BI2", data = d)),
  fixed_huge_loading = try_capture(cfa("BI =~ BI1 + 5*BI2 + BI3", data = small))
)
find$pathological <- lapply(bad, diag_of)
find$pathological$capture_recipe <- c(
  "wrap the fit in withCallingHandlers(): lavaan reports problems as WARNINGS (not errors) and still returns an object",
  "lavInspect(fit, 'converged') -> FALSE on non-convergence",
  "lavInspect(fit, 'post.check') -> FALSE (+ warning) when a variance is negative or a covariance matrix of lv/ov is not PD",
  "negative variances: parameterEstimates(fit) rows with op == '~~', lhs == rhs, est < 0"
)

# ---- parity file: lavaan ML SEM, standardised (std_all) --------------------------------------------------------------------------
ss <- standardizedSolution(fit_ml)
paths <- data.frame(from = TAM_PATHS$from, to = TAM_PATHS$to,
                    est = mapply(function(f, t) ss$est.std[ss$op == "~" & ss$lhs == t & ss$rhs == f], TAM_PATHS$from, TAM_PATHS$to),
                    stringsAsFactors = FALSE)
loads <- do.call(rbind, lapply(cons, function(k) data.frame(construct = k, indicator = TAM_BLOCKS[[k]],
  est = sapply(TAM_BLOCKS[[k]], function(i) ss$est.std[ss$op == "=~" & ss$lhs == k & ss$rhs == i]), stringsAsFactors = FALSE)))
r2 <- lavInspect(fit_ml, "r2")
write_parity(
  engine = "lavaan", variant = "sem-ml",
  options = list(estimator = "ML", identification = "marker (default)", reported = "standardizedSolution type std_all", missing = "listwise (no NA in data)"),
  paths = paths, loadings = loads, weights = NULL,
  r2 = as.list(r2[names(TAM_STRUCT)]),
  extra = list(
    fit = fm_of(fit_ml)$selected,
    unstandardisedPaths = df_rows(pe_m[pe_m$op == "~", c("lhs", "rhs", "est", "se")]),
    latentCorrelations = mat_named(lavInspect(fit_ml, "cor.lv")),
    converged = lavInspect(fit_ml, "converged")
  )
)

write_evidence("lavaan", find, packages = c("lavaan"))
