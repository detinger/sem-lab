# Phase 0 spike - cSEM post-estimation and advanced features: SMOKE runs.
#
# Each feature is called once on a small configuration. Unless a check against an
# independent computation is recorded under `check`, the status is "smoke-only":
# the call ran (or failed) and the returned structure is recorded, the numbers
# are NOT verified.
#
# Group tests use a FABRICATED grouping (row parity: odd rows = group "odd", even
# rows = group "even"). It has no substantive meaning; it only exercises the API.
#
# Evidence: docs/validation/phase-0/evidence/r/csem_smoke.json

source(file.path(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "_common.R"))
suppressPackageStartupMessages(library(cSEM))

d <- load_tam()
n <- nrow(d)
cons <- names(TAM_BLOCKS)
m_cf <- tam_model_syntax("=~")
m_comp <- tam_model_syntax("<~")
classic <- csem(d, m_cf, .disattenuate = FALSE)
plsc <- csem(d, m_cf)
find <- list()
shape <- function(x, depth = 2) {
  if (depth == 0 || !is.list(x) || is.data.frame(x)) {
    if (is.matrix(x) || is.data.frame(x)) return(list(class = class(x)[1], dim = dim(x), colnames = utils::head(colnames(x), 12)))
    return(list(class = class(x)[1], length = length(x)))
  }
  lapply(x, shape, depth = depth - 1)
}

# ---- predict(): PLSpredict-style out-of-sample prediction ----------------------------
pr <- try_capture(predict(classic, .benchmark = "lm", .cv_folds = 10, .r = 1, .seed = 42))
pr2 <- try_capture(predict(classic, .benchmark = "lm", .cv_folds = 10, .r = 1, .seed = 42))
find$predict <- list(
  formals = formals_of(cSEM::predict),
  call = "predict(<classic Mode A object>, .benchmark = 'lm', .cv_folds = 10, .r = 1, .seed = 42)",
  run = status_of(pr, function(v) list(
    class = class(v), names = names(v),
    prediction_metrics = df_rows(v$Prediction_metrics),
    information_names = names(v$Information))),
  same_seed_reproducible = if (pr$ok && pr2$ok) identical(pr$value$Prediction_metrics, pr2$value$Prediction_metrics) else NULL,
  on_plsc_object = status_of(try_capture(predict(plsc, .benchmark = "lm", .cv_folds = 5, .seed = 1)),
                             function(v) list(metric_cols = names(v$Prediction_metrics)))
)

# ---- testCVPAT(): compare full model vs model without ATU -> BI ------------------------------
m_alt <- sub("BI ~ PU + ATU", "BI ~ PU", m_cf, fixed = TRUE)
alt <- csem(d, m_alt, .disattenuate = FALSE)
cv <- try_capture(testCVPAT(.object1 = classic, .object2 = alt, .seed = 3, .cv_folds = 10))
find$testCVPAT <- list(
  formals = formals_of(testCVPAT),
  call = "testCVPAT(.object1 = tam-v1 classic, .object2 = tam-v1 without BI ~ ATU, .seed = 3, .cv_folds = 10)",
  run = status_of(cv, function(v) list(class = class(v), shape = shape(unclass(v), 1),
                                       printed = utils::head(utils::capture.output(print(v)), 40)))
)

# ---- group tests (FABRICATED grouping by row parity) ----------------------------------------
dg <- d
dg$grp <- ifelse(seq_len(n) %% 2 == 1, "odd", "even")
multi <- try_capture(csem(dg, m_cf, .id = "grp", .disattenuate = FALSE))
multi_comp <- try_capture(csem(dg, m_comp, .id = "grp", .PLS_modes = "modeA"))
find$multigroup_estimation <- list(
  grouping = "FABRICATED: row parity (odd / even row number). No substantive meaning.",
  call = "csem(data_with_grp, model, .id = 'grp', .disattenuate = FALSE)",
  run = status_of(multi, function(v) list(class = class(v), groups = names(v),
    paths_by_group = lapply(v, function(g) csem_paths_df(g)$est))),
  check = if (multi$ok) {
    odd <- csem(d[seq_len(n) %% 2 == 1, ], m_cf, .disattenuate = FALSE)
    list(max_abs_diff_group_odd_vs_separate_fit_on_odd_rows = max_abs_diff(csem_paths_df(multi$value$odd)$est, csem_paths_df(odd)$est))
  }
)
mic <- if (multi_comp$ok) try_capture(testMICOM(multi_comp$value, .R = 30, .seed = 5, .verbose = FALSE)) else NULL
find$testMICOM <- list(
  formals = formals_of(testMICOM),
  call = "testMICOM(<multi-group composite Mode A object>, .R = 30, .seed = 5)",
  run = if (is.null(mic)) multi_comp$error else status_of(mic, function(v) list(class = class(v), names = names(v), shape = shape(unclass(v), 2),
                                                                      printed = utils::head(utils::capture.output(print(v)), 60)))
)
mgd <- if (multi$ok) try_capture(testMGD(multi$value, .approach_mgd = c("Klesel", "Chin", "Sarstedt", "Henseler"),
                                          .R_permutation = 30, .R_bootstrap = 30, .seed = 5, .verbose = FALSE)) else NULL
find$testMGD <- list(
  formals = formals_of(testMGD),
  approach_mgd_values = eval(formals(testMGD)$.approach_mgd),
  call = "testMGD(<multi-group classic object>, .approach_mgd = c('Klesel','Chin','Sarstedt','Henseler'), .R_permutation = 30, .R_bootstrap = 30, .seed = 5)",
  run = if (is.null(mgd)) multi$error else status_of(mgd, function(v) list(class = class(v), names = names(v),
                                                                  printed = utils::head(utils::capture.output(print(v)), 80)))
)

# ---- testOMF / testHausman ---------------------------------------------------------------------
omf <- try_capture(testOMF(classic, .R = 30, .seed = 5))
find$testOMF <- list(
  formals = formals_of(testOMF),
  call = "testOMF(<classic>, .R = 30, .seed = 5)",
  run = status_of(omf, function(v) list(class = class(v), names = names(v), printed = utils::head(utils::capture.output(print(v)), 40)))
)
haus <- try_capture(testHausman(plsc, .R = 30, .seed = 5))
haus_cl <- try_capture(testHausman(classic, .R = 30, .seed = 5))
find$testHausman <- list(
  formals = formals_of(testHausman),
  on_plsc = status_of(haus, function(v) list(class = class(v), names = names(v), printed = utils::head(utils::capture.output(print(v)), 40))),
  on_classic = status_of(haus_cl, function(v) list(class = class(v), names = names(v)))
)

# ---- doRedundancyAnalysis / calculatef2 ----------------------------------------------------------
mixed <- csem(d, tam_model_syntax(c(PU = "<~", PEOU = "<~", ATU = "=~", BI = "=~", USE = "=~")), .disattenuate = FALSE)
ra <- try_capture(doRedundancyAnalysis(mixed))
ra_cf <- try_capture(doRedundancyAnalysis(classic))
find$doRedundancyAnalysis <- list(
  formals = formals_of(doRedundancyAnalysis),
  note = "No argument for the global/criterion item: from the help, the redundancy analysis needs the formative construct to be linked to a reflectively measured construct in the model specification by the user.",
  on_mixed = status_of(ra, function(v) list(class = class(v), value = if (is.numeric(v)) vec_named(v) else shape(v))),
  on_all_common_factor = status_of(ra_cf, function(v) list(class = class(v), value = if (is.numeric(v)) vec_named(v) else shape(v)))
)
# Redundancy analysis by hand for a design where it applies: PU as Mode B composite of USEF1..USEF4,
# and a reflective "global" PU_G measured by USEF5, with PU_G ~ PU. Redundancy = path coefficient PU_G ~ PU.
m_ra <- "PU <~ USEF1 + USEF2 + USEF3 + USEF4\nPU_G =~ USEF5\nPU_G ~ PU"
ra2 <- try_capture({ o <- csem(d, m_ra); list(o = o, ra = doRedundancyAnalysis(o)) })
find$doRedundancyAnalysis$single_item_global <- status_of(ra2, function(v) list(
  value = vec_named(unlist(v$ra)),
  check_vs_path_PU_G_on_PU = max_abs_diff(unlist(v$ra)[1], v$o$Estimates$Path_estimates["PU_G", "PU"]),
  check_vs_cor_score_USEF5 = max_abs_diff(unlist(v$ra)[1], stats::cor(scale(d[, paste0("USEF", 1:4)]) %*% v$o$Estimates$Weight_estimates["PU", paste0("USEF", 1:4)], d$USEF5)),
  # what the source actually does: re-estimate the same model with the Mode B block switched to Mode A,
  # regress the Mode A score on the original Mode B score (both standardised -> a correlation)
  check_vs_cor_modeB_score_with_modeA_reestimate = {
    oa <- csem(d, m_ra, .PLS_modes = list(PU = "modeA", PU_G = "modeA"))
    max_abs_diff(unlist(v$ra)[1], stats::cor(v$o$Estimates$Construct_scores[, "PU"], oa$Estimates$Construct_scores[, "PU"]))
  },
  conclusion_from_source = "cSEM's doRedundancyAnalysis() is NOT the textbook (Chin 1998) redundancy analysis against a global single item: for every Mode B block it re-estimates the model with that block in Mode A and returns the OLS slope of the Mode A score on the Mode B score."
))
f2 <- try_capture(calculatef2(classic))
find$calculatef2 <- list(
  formals = formals_of(calculatef2),
  run = status_of(f2, function(v) list(f2 = mat_named(v))),
  check_vs_assess_F2 = if (f2$ok) max_abs_diff(f2$value, assess(classic, .quality_criterion = "f2")$F2[rownames(f2$value), colnames(f2$value)]) else NULL,
  note = "assess()$F2 was verified against the f2 formula in csem_assess.json"
)

# ---- second-order construct -------------------------------------------------------------------------
m_2nd <- paste(
  "PU =~ USEF1 + USEF2 + USEF3 + USEF4 + USEF5",
  "PEOU =~ EOU1 + EOU2 + EOU3 + EOU4 + EOU5",
  "ATU =~ ATT1 + ATT2 + ATT3 + ATT4 + ATT5",
  "BI =~ BI1 + BI2 + BI3",
  "COG <~ PU + PEOU",
  "ATU ~ COG", "BI ~ ATU", sep = "\n")
so <- lapply(stats::setNames(nm = eval(formals(csem)$.approach_2ndorder)), function(a) {
  tc <- try_capture(csem(d, m_2nd, .approach_2ndorder = a, .disattenuate = FALSE))
  status_of(tc, function(v) list(class = class(v), names = names(v),
    paths_second_stage = if (!is.null(v$Second_stage)) mat_named(v$Second_stage$Estimates$Path_estimates) else NULL,
    verify = as.list(unlist(verify(v)))))
})
find$second_order <- list(
  model = m_2nd,
  approach_2ndorder_values = eval(formals(csem)$.approach_2ndorder),
  by_approach = so,
  doIPMA_on_2ndorder = status_of(try_capture(doIPMA(csem(d, m_2nd, .disattenuate = FALSE)))),
  syntax_note = "a construct whose 'indicators' are other constructs is a second-order construct; '<~' gives a composite of the first-order construct scores"
)

# ---- interaction (nonlinear) term ----------------------------------------------------------------------
m_int <- sub("ATU ~ PEOU + PU", "ATU ~ PEOU + PU + PEOU.PU", m_cf, fixed = TRUE)
it <- try_capture(csem(d, m_int, .disattenuate = FALSE))
find$interaction <- list(
  model_line = "ATU ~ PEOU + PU + PEOU.PU   (cSEM: product of construct scores, written with '.')",
  approach_nl_values = eval(formals(csem)$.approach_nl),
  run = status_of(it, function(v) list(model_type = v$Information$Model$model_type,
                                       ATU_paths = vec_named(v$Estimates$Path_estimates["ATU", c("PEOU", "PU", "PEOU.PU")]),
                                       verify = as.list(unlist(verify(v))))),
  check = if (it$ok) {
    v <- it$value; sc <- v$Estimates$Construct_scores
    prod_term <- sc[, "PEOU"] * sc[, "PU"]
    fit <- stats::lm(sc[, "ATU"] ~ sc[, "PEOU"] + sc[, "PU"] + prod_term)
    list(note = "OLS of ATU score on PEOU, PU and their (unstandardised) product; cSEM standardises the product term, so only the main-effect slopes and the t-value of the product are comparable",
         ols_coef = as.list(stats::coef(fit)))
  },
  floodlight_smoke = if (it$ok) status_of(try_capture(doNonlinearEffectsAnalysis(it$value, .dependent = "ATU", .independent = "PU", .moderator = "PEOU")),
                                          function(v) list(class = class(v), names = names(v))) else NULL,
  doIPMA_on_nonlinear = if (it$ok) status_of(try_capture(doIPMA(it$value))) else NULL
)

# ---- alternative weighting approaches --------------------------------------------------------------------
aw <- lapply(stats::setNames(nm = eval(formals(csem)$.approach_weights)), function(a) {
  tc <- try_capture(csem(d, m_comp, .approach_weights = a))
  status_of(tc, function(v) list(paths = csem_paths_df(v)$est, r2 = vec_named(v$Estimates$R2),
                                 verify_problems = sum(unlist(verify(v)))))
})
aw_cf <- lapply(stats::setNames(nm = c("GSCA", "PCA", "unit")), function(a) {
  status_of(try_capture(csem(d, m_cf, .approach_weights = a)), function(v) list(
    paths = csem_paths_df(v)$est, construct_type = as.list(v$Information$Model$construct_type),
    disattenuated = isTRUE(v$Information$Arguments$.disattenuate)))
})
# independent check of 'unit' weights: composite = sum of standardised indicators, rescaled to unit variance; OLS paths
Z <- scale(d)
uscore <- sapply(cons, function(k) { s <- rowSums(Z[, TAM_BLOCKS[[k]]]); (s - mean(s)) / stats::sd(s) })
unit_ref <- mapply(function(f, t) {
  pr_ <- TAM_STRUCT[[t]]; R <- stats::cor(uscore[, pr_, drop = FALSE]); r <- stats::cor(uscore[, pr_, drop = FALSE], uscore[, t])
  b <- solve(R, r); b[match(f, pr_)]
}, TAM_PATHS$from, TAM_PATHS$to)
# independent check of 'PCA': first principal component of each block's correlation matrix
pscore <- sapply(cons, function(k) { e <- eigen(stats::cor(d[, TAM_BLOCKS[[k]]])); v <- e$vectors[, 1]; v <- v * sign(sum(v)); s <- Z[, TAM_BLOCKS[[k]]] %*% v; s / stats::sd(s) })
pca_ref <- mapply(function(f, t) {
  pr_ <- TAM_STRUCT[[t]]; b <- solve(stats::cor(pscore[, pr_, drop = FALSE]), stats::cor(pscore[, pr_, drop = FALSE], pscore[, t])); b[match(f, pr_)]
}, TAM_PATHS$from, TAM_PATHS$to)
find$approach_weights <- list(
  values = eval(formals(csem)$.approach_weights),
  composite_model = aw,
  common_factor_model = aw_cf,
  check = list(
    unit_paths_vs_hand_computation = if (aw$unit$ok) max_abs_diff(aw$unit$result$paths, unit_ref) else NULL,
    PCA_paths_vs_first_principal_component = if (aw$PCA$ok) max_abs_diff(aw$PCA$result$paths, pca_ref) else NULL
  ),
  GSCA_note = "GSCA is a different estimator family (generalized structured component analysis); with '=~' cSEM runs GSCA_m. Numbers NOT verified."
)

write_evidence("csem_smoke", find, packages = c("cSEM"))
