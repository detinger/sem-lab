# Normalisation of a cSEM fit (and optional bootstrap draws) into NormalizedSemResult
# pieces (docs/architecture/contracts.md §6). Every number is tied to model ids and
# every null carries a missing reason.

SOURCE_CSEM <- "cSEM::csem"
SOURCE_EFFECTS <- "SEM Lab from cSEM::csem path estimates"

# ---- the estimated parameter vector theta ------------------------------------------

#' One row per path / loading / weight: result key, ids, alias position in the cSEM
#' matrices and the column name cSEM uses for its resampled draws.
theta_spec <- function(spec, al) {
  rows <- list()
  for (i in seq_len(nrow(spec$paths))) {
    s <- spec$paths$source[i]; t <- spec$paths$target[i]
    rows[[length(rows) + 1L]] <- data.frame(
      key = sprintf("path:%s->%s", s, t), kind = "path", source_id = s, target_id = t,
      rel_id = spec$paths$id[i], mat = "Path_estimates", row = al$construct[[t]], col = al$construct[[s]],
      resample_col = sprintf("%s ~ %s", al$construct[[t]], al$construct[[s]]), single = FALSE,
      stringsAsFactors = FALSE)
  }
  for (cc in spec$constructs) {
    single <- length(cc$indicator_ids) == 1L
    for (ii in cc$indicator_ids) {
      ca <- al$construct[[cc$id]]; xa <- al$indicator[[ii]]
      rows[[length(rows) + 1L]] <- data.frame(
        key = sprintf("loading:%s:%s", cc$id, ii), kind = "loading", source_id = cc$id, target_id = ii,
        rel_id = NA_character_, mat = "Loading_estimates", row = ca, col = xa,
        resample_col = sprintf("%s =~ %s", ca, xa), single = single, stringsAsFactors = FALSE)
      rows[[length(rows) + 1L]] <- data.frame(
        key = sprintf("weight:%s:%s", cc$id, ii), kind = "weight", source_id = cc$id, target_id = ii,
        rel_id = NA_character_, mat = "Weight_estimates", row = ca, col = xa,
        resample_col = sprintf("%s <~ %s", ca, xa), single = single, stringsAsFactors = FALSE)
    }
  }
  do.call(rbind, rows)
}

extract_theta_fit <- function(fit, ts) {
  v <- vapply(seq_len(nrow(ts)), function(i) fit$Estimates[[ts$mat[i]]][ts$row[i], ts$col[i]], numeric(1))
  stats::setNames(v, ts$key)
}

# ---- effects --------------------------------------------------------------------------

#' Effects bookkeeping for the structural model (pairs, specific paths, keys).
effects_spec <- function(spec) {
  cons <- names(spec$constructs)
  cp <- connected_pairs(cons, spec$paths$source, spec$paths$target, MAX_SPECIFIC_INDIRECT)
  specific <- list()
  for (p in cp$pairs) for (nodes in p$specific) {
    specific[[length(specific) + 1L]] <- list(
      key = paste0("specific-indirect:", paste(nodes, collapse = "->")),
      source = nodes[1], target = nodes[length(nodes)], via = nodes[-c(1, length(nodes))],
      path_keys = sprintf("path:%s->%s", nodes[-length(nodes)], nodes[-1]))
  }
  list(pairs = cp$pairs, specific = specific, truncated = cp$truncated, cons = cons)
}

#' Effects for a matrix of path draws (rows = draws, columns = "path:" keys).
#' total = (I - B)^-1 - I, indirect = total - B (recursive model), specific = product
#' of the path coefficients along the chain.
compute_effects <- function(P, spec, es) {
  P <- as.matrix(P)
  cons <- es$cons
  k <- length(cons)
  idx_from <- match(spec$paths$source, cons)
  idx_to <- match(spec$paths$target, cons)
  pkeys <- sprintf("path:%s->%s", spec$paths$source, spec$paths$target)
  D <- nrow(P)
  pr_s <- match(vapply(es$pairs, `[[`, "", "source"), cons)
  pr_t <- match(vapply(es$pairs, `[[`, "", "target"), cons)
  tot <- matrix(NA_real_, D, length(es$pairs))
  ind <- matrix(NA_real_, D, length(es$pairs))
  I <- diag(k)
  for (d in seq_len(D)) {
    B <- matrix(0, k, k)
    B[cbind(idx_to, idx_from)] <- P[d, pkeys]
    Tm <- solve(I - B) - I
    tot[d, ] <- Tm[cbind(pr_t, pr_s)]
    ind[d, ] <- (Tm - B)[cbind(pr_t, pr_s)]
  }
  sp <- matrix(NA_real_, D, length(es$specific))
  for (j in seq_along(es$specific)) {
    sp[, j] <- Reduce(`*`, lapply(es$specific[[j]]$path_keys, function(pk) P[, pk]))
  }
  list(total = tot, indirect = ind, specific = sp)
}

# ---- numbers with reasons ----------------------------------------------------------------

num_or_reason <- function(x, reason) {
  if (is.null(x) || length(x) != 1L || is.na(x) && !is.nan(x)) return(list(value = NA_real_, reason = reason))
  if (!is.finite(x)) return(list(value = NA_real_, reason = "non-finite"))
  list(value = unname(as.numeric(x)), reason = NULL)
}

#' Bootstrap inference for one parameter from its valid draws.
#' se = sd(draws) (divisor B_valid - 1); t = est / se; p from the t distribution with
#' df = B_valid - 1 (two-sided: 2 * pt(-|t|, df); one-sided: pt(-|t|, df), in the
#' direction of the point estimate's sign); percentile CI = quantile(type = 7).
infer_from_draws <- function(est, draws, boot) {
  draws <- draws[is.finite(draws)]
  nv <- length(draws)
  out <- list(nValid = nv)
  if (!is.finite(est) || nv < 2L) {
    r <- if (!is.finite(est)) "non-finite" else "failed"
    out[c("se", "statistic", "pValue", "ciLower", "ciUpper")] <- list(NULL)
    out$reason <- r
    return(out)
  }
  se <- stats::sd(draws)
  t <- est / se
  df <- nv - 1L
  L <- boot$level
  if (boot$sides == "two-sided") {
    p <- 2 * stats::pt(-abs(t), df)
    q <- stats::quantile(draws, c((1 - L) / 2, 1 - (1 - L) / 2), type = 7, names = FALSE)
    lo <- q[1]; hi <- q[2]
  } else {
    p <- stats::pt(-abs(t), df)
    if (est >= 0) { lo <- stats::quantile(draws, 1 - L, type = 7, names = FALSE); hi <- NULL }
    else { lo <- NULL; hi <- stats::quantile(draws, L, type = 7, names = FALSE) }
  }
  if (is.finite(p)) p <- min(1, max(0, p))
  out$se <- se; out$statistic <- t; out$pValue <- p; out$ciLower <- lo; out$ciUpper <- hi
  out
}

INFERENCE_NOTE <- "se = sd(valid draws, divisor B_valid-1); t = est/se; p from t distribution, df = B_valid-1; CI = percentile, quantile(type 7)"

#' Build one ParameterEstimate list.
param_entry <- function(key, kind, est, source_id = NULL, target_id = NULL, via = NULL, rel_id = NULL,
                        inf = NULL, boot = NULL, status = "estimated", source_method = SOURCE_CSEM,
                        raw_path = NULL, fixed_reason = NULL) {
  p <- list(key = key, kind = kind)
  if (!is.null(source_id)) p$sourceId <- source_id
  if (!is.null(target_id)) p$targetId <- target_id
  if (!is.null(via)) p$viaIds <- I(via)
  if (!is.null(rel_id) && !is.na(rel_id)) p$relationshipId <- rel_id
  p$scale <- "standardized"
  missing <- list()
  e <- num_or_reason(est, "non-finite")
  p$est <- e$value
  if (!is.null(e$reason)) { missing$est <- e$reason; status <- "failed" }
  fields <- c("se", "statistic", "pValue", "ciLower", "ciUpper")
  if (!is.null(fixed_reason)) {
    for (f in fields) { p[[f]] <- NA_real_; missing[[f]] <- fixed_reason }
  } else if (is.null(boot)) {
    for (f in fields) { p[[f]] <- NA_real_; missing[[f]] <- "not-requested" }
  } else {
    for (f in fields) {
      v <- inf[[f]]
      if (is.null(v)) {
        p[[f]] <- NA_real_
        missing[[f]] <- if (!is.null(inf$reason)) inf$reason
                        else if (f %in% c("ciLower", "ciUpper")) "not-applicable" else "failed"
      } else {
        nv <- num_or_reason(v, "failed")
        p[[f]] <- nv$value
        if (!is.null(nv$reason)) missing[[f]] <- nv$reason
      }
    }
    p$statisticType <- "t"
  }
  if (length(missing)) p$missing <- missing
  p$status <- status
  if (!is.null(boot) && is.null(fixed_reason)) {
    p$inference <- list(method = "bootstrap-percentile", level = boot$level, sides = boot$sides,
                        nValid = as.integer(inf$nValid))
  }
  p$sourceMethod <- source_method
  if (!is.null(raw_path)) p$rawPath <- substr(raw_path, 1L, 400L)
  p
}

#' All ParameterEstimates: paths, loadings, weights, total effects, total indirect
#' effects, specific indirect effects. `bs` is the bootstrap result or NULL.
build_parameters <- function(spec, al, ts, theta, es, eff_est, bs) {
  boot <- spec$bootstrap
  out <- list()
  for (i in seq_len(nrow(ts))) {
    r <- ts[i, ]
    raw <- sprintf("Estimates$%s[\"%s\", \"%s\"]", r$mat, r$row, r$col)
    fixed <- if (r$single) "not-applicable" else NULL
    inf <- if (!is.null(bs) && is.null(fixed)) infer_from_draws(theta[[r$key]], bs$draws[, r$key], boot) else NULL
    if (!is.null(bs) && is.null(fixed)) raw <- paste0(raw, "; ", INFERENCE_NOTE)
    if (!is.null(fixed)) raw <- paste0(raw, "; single-indicator block: fixed at 1 by construction")
    out[[length(out) + 1L]] <- param_entry(
      r$key, r$kind, theta[[r$key]], r$source_id, r$target_id, rel_id = r$rel_id,
      inf = inf, boot = if (is.null(fixed)) bs_boot(bs, boot) else NULL,
      status = if (is.null(fixed)) "estimated" else "fixed", raw_path = raw, fixed_reason = fixed)
  }
  for (j in seq_along(es$pairs)) {
    pr <- es$pairs[[j]]
    key <- sprintf("total:%s->%s", pr$source, pr$target)
    inf <- if (!is.null(bs)) infer_from_draws(eff_est$total[1, j], bs$effects$total[, j], boot) else NULL
    out[[length(out) + 1L]] <- param_entry(
      key, "total-effect", eff_est$total[1, j], pr$source, pr$target, inf = inf, boot = bs_boot(bs, boot),
      source_method = SOURCE_EFFECTS,
      raw_path = paste0("(I - B)^-1 - I, B = Estimates$Path_estimates", if (!is.null(bs)) paste0("; per draw; ", INFERENCE_NOTE) else ""))
  }
  for (j in seq_along(es$pairs)) {
    pr <- es$pairs[[j]]
    if (!pr$has_indirect) next
    key <- sprintf("indirect:%s->%s", pr$source, pr$target)
    inf <- if (!is.null(bs)) infer_from_draws(eff_est$indirect[1, j], bs$effects$indirect[, j], boot) else NULL
    out[[length(out) + 1L]] <- param_entry(
      key, "indirect-effect", eff_est$indirect[1, j], pr$source, pr$target, inf = inf, boot = bs_boot(bs, boot),
      source_method = SOURCE_EFFECTS,
      raw_path = paste0("(I - B)^-1 - I - B, B = Estimates$Path_estimates", if (!is.null(bs)) paste0("; per draw; ", INFERENCE_NOTE) else ""))
  }
  for (j in seq_along(es$specific)) {
    s <- es$specific[[j]]
    if (nchar(s$key) > 400L) next
    inf <- if (!is.null(bs)) infer_from_draws(eff_est$specific[1, j], bs$effects$specific[, j], boot) else NULL
    out[[length(out) + 1L]] <- param_entry(
      s$key, "specific-indirect", eff_est$specific[1, j], s$source, s$target, via = s$via, inf = inf,
      boot = bs_boot(bs, boot), source_method = SOURCE_EFFECTS,
      raw_path = paste0("product of Estimates$Path_estimates along the chain", if (!is.null(bs)) paste0("; per draw; ", INFERENCE_NOTE) else ""))
  }
  out
}

bs_boot <- function(bs, boot) if (is.null(bs)) NULL else boot

# ---- construct metrics -------------------------------------------------------------------

DEF <- list(
  r2 = "R²: share of the endogenous construct's variance explained by its predictors (cSEM Estimates$R2, OLS on the construct correlation matrix). Defined for endogenous constructs only.",
  r2adj = "Adjusted R² = 1 - (1 - R²)(n - 1)/(n - k - 1), n = rows used, k = number of predictors (cSEM Estimates$R2adj). Defined for endogenous constructs only.",
  alpha = "Cronbach's alpha, standardized (correlation-based): k·r̄/(1 + (k - 1)·r̄), r̄ = mean inter-item correlation of the block (cSEM assess() RhoT). Reflective blocks with at least 2 indicators only.",
  rhoa = "Dijkstra–Henseler rho_A of the Mode A weights, taken from a PLSc (consistent PLS) fit of the same model (cSEM Estimates$Reliabilities; the weights equal those of the classic fit). Reflective blocks with at least 2 indicators only.",
  rhoc = "Composite reliability rho_C = (Σλ)² / ((Σλ)² + Σ(1 - λ²)) on the reported standardized loadings (cSEM assess() RhoC). Reflective blocks with at least 2 indicators only.",
  ave = "Average variance extracted: mean of the squared reported standardized loadings (cSEM assess() AVE). Reflective blocks with at least 2 indicators only."
)

metric_entry <- function(cid, metric, value, reason, definition) {
  v <- num_or_reason(value, reason)
  m <- list(constructId = cid, metric = metric, value = v$value)
  if (!is.null(v$reason)) m$missing <- v$reason
  m$definition <- definition
  m
}

safe_assess <- function(fit, crit) {
  tryCatch(suppressWarnings(cSEM::assess(fit, .quality_criterion = crit)), error = function(e) {
    log_line("assess(", crit, ") failed: ", sanitize_message(conditionMessage(e)))
    NULL
  })
}

build_construct_metrics <- function(spec, al, fit, rho_fit, n) {
  a_ave <- safe_assess(fit, "ave")$AVE
  a_rhoc <- safe_assess(fit, "rho_C")$RhoC
  a_alpha <- safe_assess(fit, "rho_T")$RhoT
  r2 <- fit$Estimates$R2
  r2a <- fit$Estimates$R2adj
  rel <- if (!is.null(rho_fit)) rho_fit$Estimates$Reliabilities else NULL
  endo <- unique(spec$paths$target)
  out <- list()
  get <- function(v, a) if (!is.null(v) && a %in% names(v)) v[[a]] else NULL
  for (cc in spec$constructs) {
    a <- al$construct[[cc$id]]
    is_endo <- cc$id %in% endo
    out[[length(out) + 1L]] <- metric_entry(cc$id, "r2", if (is_endo) get(r2, a) else NULL,
                                            if (is_endo) "failed" else "not-applicable", DEF$r2)
    out[[length(out) + 1L]] <- metric_entry(cc$id, "r2-adjusted", if (is_endo) get(r2a, a) else NULL,
                                            if (is_endo) "failed" else "not-applicable", DEF$r2adj)
    eligible <- cc$measurement == "reflective" && length(cc$indicator_ids) >= 2L
    na_reason <- "not-applicable"
    out[[length(out) + 1L]] <- metric_entry(cc$id, "cronbach-alpha", if (eligible) get(a_alpha, a) else NULL,
                                            if (eligible) "failed" else na_reason, DEF$alpha)
    out[[length(out) + 1L]] <- metric_entry(cc$id, "rho-a", if (eligible) get(rel, a) else NULL,
                                            if (eligible) "failed" else na_reason, DEF$rhoa)
    out[[length(out) + 1L]] <- metric_entry(cc$id, "rho-c", if (eligible) get(a_rhoc, a) else NULL,
                                            if (eligible) "failed" else na_reason, DEF$rhoc)
    out[[length(out) + 1L]] <- metric_entry(cc$id, "ave", if (eligible) get(a_ave, a) else NULL,
                                            if (eligible) "failed" else na_reason, DEF$ave)
  }
  out
}

# ---- matrices -----------------------------------------------------------------------------

mat_values <- function(M) {
  lapply(seq_len(nrow(M)), function(i) {
    v <- as.numeric(M[i, ])
    v[!is.finite(v)] <- NA_real_
    I(v)
  })
}

matrix_entry <- function(id, title, row_ids, col_ids, M, symmetric, definition, missing = NULL) {
  m <- list(id = id, title = title, rowIds = I(as.character(row_ids)), colIds = I(as.character(col_ids)),
            values = if (length(row_ids)) mat_values(M) else list(), symmetric = symmetric,
            definition = definition)
  if (!is.null(missing)) m$missing <- missing
  m
}

#' Symmetric matrix from cSEM's lower-triangular HTMT output, indexed by alias.
sym_lower <- function(M) {
  S <- M
  S[upper.tri(S)] <- t(M)[upper.tri(S)]
  S
}

build_matrices <- function(spec, al, fit, X_alias) {
  cons <- names(spec$constructs)
  ca <- al$construct[cons]
  eligible <- cons[vapply(spec$constructs, function(cc) cc$measurement == "reflective" && length(cc$indicator_ids) >= 2L, logical(1))]
  ea <- al$construct[eligible]
  out <- list()

  for (type in c("htmt", "htmt2")) {
    title <- if (type == "htmt") "Heterotrait–monotrait ratio (HTMT)" else "HTMT2 (geometric-mean HTMT)"
    def <- paste0(if (type == "htmt") "HTMT (Henseler, Ringle & Sarstedt, 2015): mean absolute heterotrait correlation / sqrt(product of the mean absolute monotrait correlations)"
                  else "HTMT2 (Roemer, Schuberth & Henseler, 2021): as HTMT with geometric instead of arithmetic means",
                  ", on Pearson indicator correlations (cSEM assess(), .absolute = TRUE). Reflective constructs with at least 2 indicators only; other constructs are omitted (not applicable). Diagonal is null (not applicable).")
    if (length(eligible) < 2L) {
      out[[length(out) + 1L]] <- matrix_entry(type, title, character(0), character(0), NULL, TRUE, def, "not-applicable")
      next
    }
    h <- safe_assess(fit, type)
    hm <- h[[toupper(type)]]$htmts
    if (is.null(hm) || !all(ea %in% rownames(hm))) {
      out[[length(out) + 1L]] <- matrix_entry(type, title, character(0), character(0), NULL, TRUE, def, "failed")
      next
    }
    M <- sym_lower(hm)[ea, ea, drop = FALSE]
    diag(M) <- NA_real_
    out[[length(out) + 1L]] <- matrix_entry(type, title, eligible, eligible, M, TRUE, def)
  }

  fl_def <- "Fornell–Larcker matrix (cSEM assess() fl_criterion): diagonal = AVE, off-diagonal = squared construct correlations. Reflective constructs with at least 2 indicators only."
  fl <- if (length(eligible)) safe_assess(fit, "fl_criterion")[["Fornell-Larcker"]] else NULL
  if (!length(eligible)) {
    out[[length(out) + 1L]] <- matrix_entry("fornell-larcker", "Fornell–Larcker criterion", character(0), character(0), NULL, TRUE, fl_def, "not-applicable")
  } else if (is.null(fl) || !all(ea %in% rownames(fl))) {
    out[[length(out) + 1L]] <- matrix_entry("fornell-larcker", "Fornell–Larcker criterion", character(0), character(0), NULL, TRUE, fl_def, "failed")
  } else {
    out[[length(out) + 1L]] <- matrix_entry("fornell-larcker", "Fornell–Larcker criterion", eligible, eligible,
                                            fl[ea, ea, drop = FALSE], TRUE, fl_def)
  }

  scores <- fit$Estimates$Construct_scores[, ca, drop = FALSE]
  xa <- al$indicator[spec$indicator_ids]
  CL <- stats::cor(X_alias[, xa, drop = FALSE], scores)
  out[[length(out) + 1L]] <- matrix_entry(
    "cross-loadings", "Cross-loadings", spec$indicator_ids, cons, CL, FALSE,
    paste0("Pearson correlation of each indicator with each construct score (cSEM Estimates$Construct_scores, standardized composites).",
           if (spec$method == "plsc") " For PLSc the own-block entries are composite (proxy) correlations and therefore differ from the consistency-corrected loadings." else ""))

  out[[length(out) + 1L]] <- matrix_entry(
    "construct-correlations", "Construct correlations", cons, cons, fit$Estimates$Construct_VCV[ca, ca, drop = FALSE], TRUE,
    if (spec$method == "plsc") "Construct correlations (cSEM Estimates$Construct_VCV): consistency-corrected for reflective constructs (PLSc), composite correlations for Mode B constructs."
    else "Construct correlations (cSEM Estimates$Construct_VCV): correlations of the standardized composites (classic PLS, no consistency correction).")

  # f2 and structural VIF: rows = predictor constructs, columns = endogenous constructs
  endo <- cons[cons %in% spec$paths$target]
  preds <- cons[cons %in% spec$paths$source]
  F2 <- safe_assess(fit, "f2")$F2
  M <- matrix(NA_real_, length(preds), length(endo))
  V <- matrix(NA_real_, length(preds), length(endo))
  vif_list <- fit$Estimates$VIF
  for (i in seq_len(nrow(spec$paths))) {
    s <- spec$paths$source[i]; t <- spec$paths$target[i]
    ri <- match(s, preds); ci <- match(t, endo)
    if (!is.null(F2)) M[ri, ci] <- F2[al$construct[[t]], al$construct[[s]]]
    n_pred <- sum(spec$paths$target == t)
    V[ri, ci] <- if (n_pred == 1L) 1 else {
      vv <- vif_list[[al$construct[[t]]]]
      if (!is.null(vv) && al$construct[[s]] %in% names(vv)) vv[[al$construct[[s]]]] else NA_real_
    }
  }
  out[[length(out) + 1L]] <- matrix_entry(
    "f2", "Effect size f²", preds, endo, M, FALSE,
    "f² = (R²_incl - R²_excl) / (1 - R²_incl) per structural path (row = predictor, column = endogenous construct), cSEM definition (assess() F2): R²_excl drops the predictor from the regression on the SAME construct correlations; the model is not re-estimated. Null where there is no path.",
    if (is.null(F2)) "failed" else NULL)
  out[[length(out) + 1L]] <- matrix_entry(
    "vif-structural", "Structural VIF", preds, endo, V, FALSE,
    "Variance inflation factor of each predictor in the regression of the endogenous construct (row = predictor, column = endogenous construct): diagonal of the inverse predictor correlation matrix (cSEM Estimates$VIF). Equals 1 by definition for a single predictor. Null where there is no path.")

  modeb <- cons[vapply(spec$constructs, function(cc) cc$mode == "B", logical(1))]
  vb_def <- "Indicator VIF within each Mode B block: diagonal of the inverse indicator correlation matrix of the block (cSEM assess() VIF_modeB). Rows = indicators of Mode B blocks, columns = Mode B constructs; null outside the indicator's own block and for single-indicator blocks."
  if (!length(modeb)) {
    out[[length(out) + 1L]] <- matrix_entry("vif-indicator-mode-b", "Indicator VIF (Mode B blocks)", character(0), character(0), NULL, FALSE, vb_def, "not-applicable")
  } else {
    VB <- safe_assess(fit, "vifmodeB")$VIF_modeB
    rows <- unlist(lapply(spec$constructs[modeb], `[[`, "indicator_ids"), use.names = FALSE)
    Mv <- matrix(NA_real_, length(rows), length(modeb))
    for (j in seq_along(modeb)) {
      cc <- spec$constructs[[modeb[j]]]
      if (length(cc$indicator_ids) < 2L || is.null(VB)) next
      cav <- al$construct[[cc$id]]
      for (ii in cc$indicator_ids) {
        xa1 <- al$indicator[[ii]]
        if (cav %in% rownames(VB) && xa1 %in% colnames(VB)) Mv[match(ii, rows), j] <- VB[cav, xa1]
      }
    }
    out[[length(out) + 1L]] <- matrix_entry("vif-indicator-mode-b", "Indicator VIF (Mode B blocks)", rows, modeb, Mv, FALSE, vb_def,
                                            if (is.null(VB)) "failed" else NULL)
  }
  out
}

# ---- fit ----------------------------------------------------------------------------------------

build_fit <- function(fit) {
  a <- list(srmr = safe_assess(fit, "srmr")$SRMR, d_uls = safe_assess(fit, "dl")$DL, d_g = safe_assess(fit, "dg")$DG)
  defs <- list(
    srmr = "Standardized root mean square residual: sqrt(mean of the squared differences between the empirical and the model-implied indicator correlations over the lower triangle INCLUDING the diagonal) (cSEM assess() SRMR, model-implied matrix from cSEM::fit()). No CB-SEM cutoffs apply.",
    d_uls = "Unweighted least-squares discrepancy d_ULS = 0.5 · Σ_ij (s_ij - σ̂_ij)² over all elements of the empirical (S) and model-implied (Σ̂) indicator correlation matrices (cSEM assess() DL). No CB-SEM cutoffs apply.",
    d_g = "Geodesic discrepancy d_G = 0.5 · Σ_i (log10 λ_i)², λ_i the eigenvalues of S⁻¹Σ̂ — cSEM uses the BASE-10 logarithm; the natural-log definition is (ln 10)² ≈ 5.30 times larger (cSEM assess() DG). No CB-SEM cutoffs apply."
  )
  lapply(names(a), function(nm) {
    v <- num_or_reason(if (length(a[[nm]])) a[[nm]][[1]] else NULL, "failed")
    f <- list(name = nm, value = v$value)
    if (!is.null(v$reason)) f$missing <- v$reason
    f$variant <- "standard"
    f$definition <- defs[[nm]]
    f
  })
}
