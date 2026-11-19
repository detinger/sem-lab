# Importance-performance map analysis (IPMA), construct and indicator level.
#
# Convention settled in Phase 0 (docs/validation/phase-0/r-spike.md §5; matched
# cSEM::doIPMA() to <= 9e-14 when the data were rescaled to 0-100 before estimation):
#   1. after reverse scoring, every indicator is rescaled with its DECLARED endpoints:
#      x100 = (x - min) / (max - min) * 100 (never the observed extrema);
#   2. classic PLS (same aliases and csem() options as the main fit) on the rescaled data;
#   3. unstandardised weight = standardised weight / sd(x100), normalised to sum to 1
#      within each block;
#   4. construct score = weighted sum of the rescaled indicators (0-100 when all weights
#      are non-negative); construct performance = mean score;
#   5. importance = unstandardised total effect on the target: OLS of each endogenous
#      score on its predictors' scores gives B_u, total = (I - B_u)^-1 - I;
#   6. indicator importance = normalised weight x construct importance; indicator
#      performance = mean rescaled indicator.
# Negative importance keeps its sign.

IPMA_CONVENTION <- paste(
  "Each indicator is first reverse scored where flagged ((min + max) - x), then rescaled to 0-100 as (x - min)/(max - min)*100",
  "with its declared original scale endpoints (never the observed minimum/maximum).",
  "Classic PLS-SEM (no consistency correction; same inner weighting scheme, iteration cap and tolerance as the main fit) is re-estimated on the rescaled data.",
  "Unstandardized outer weights = standardized weight / sd(rescaled indicator), normalized to sum to 1 within each block;",
  "construct score = weighted sum of the rescaled indicators (0-100 when no weight is negative).",
  "Performance = mean construct score (constructs) or mean rescaled indicator (indicators), on the 0-100 scale.",
  "Importance = unstandardized total effect of the construct on the target: OLS of each endogenous score on its predictors' scores gives B, total effects = (I - B)^-1 - I.",
  "Indicator importance = normalized weight x the construct's importance. Negative importance keeps its sign.",
  "Constructs listed are all predecessors of the target (any directed path); 'direct' means a direct structural path exists.",
  "Point estimates only (no bootstrap intervals)."
)

#' Rescale the (already reverse-scored) indicator matrix to 0-100 with declared endpoints.
ipma_rescale <- function(X, spec) {
  for (ii in spec$indicator_ids) {
    ind <- spec$indicators[[ii]]
    X[, ii] <- (X[, ii] - ind$scale_min) / (ind$scale_max - ind$scale_min) * 100
  }
  X
}

compute_ipma <- function(spec, al, model, X, opts) {
  ip <- spec$ipma
  cons <- names(spec$constructs)
  X100 <- ipma_rescale(X, spec)
  f <- fit_csem(alias_data(X100, al), model, opts, al, "IPMA fit on rescaled data")
  if (!convergence_of(f$fit)$converged) {
    engine_error("ENGINE_NONCONVERGENCE", "The classic PLS fit on the 0-100 rescaled data (IPMA) did not converge.",
                 list(stage = "ipma"))
  }
  W <- f$fit$Estimates$Weight_estimates
  wn <- list()
  scores <- matrix(NA_real_, nrow(X100), length(cons), dimnames = list(NULL, cons))
  for (cc in spec$constructs) {
    ids <- cc$indicator_ids
    w_std <- W[al$construct[[cc$id]], unname(al$indicator[ids])]
    w_u <- w_std / apply(X100[, ids, drop = FALSE], 2L, stats::sd)
    w_n <- stats::setNames(as.numeric(w_u / sum(w_u)), ids)
    wn[[cc$id]] <- w_n
    scores[, cc$id] <- X100[, ids, drop = FALSE] %*% w_n
  }
  k <- length(cons)
  Bu <- matrix(0, k, k, dimnames = list(cons, cons))   # Bu[to, from]
  for (t in unique(spec$paths$target)) {
    src <- spec$paths$source[spec$paths$target == t]
    fm <- stats::lm.fit(cbind(1, scores[, src, drop = FALSE]), scores[, t])
    Bu[t, src] <- fm$coefficients[-1]
  }
  Tu <- solve(diag(k) - Bu) - diag(k)
  perf_c <- colMeans(scores)
  perf_i <- colMeans(X100)
  imp <- Tu[ip$target, ip$predecessors]

  fin <- function(x) if (is.finite(x)) unname(x) else NA_real_
  warnings <- list()
  cons_out <- lapply(seq_along(ip$predecessors), function(j) {
    c0 <- ip$predecessors[j]
    list(constructId = c0, importance = fin(imp[[j]]), performance = fin(perf_c[[c0]]),
         predecessor = if (ip$direct[j]) "direct" else "indirect")
  })
  res <- list(targetConstructId = ip$target, constructs = cons_out)
  if (ip$indicator_level) {
    res$indicators <- unlist(lapply(seq_along(ip$predecessors), function(j) {
      c0 <- ip$predecessors[j]
      lapply(names(wn[[c0]]), function(ii) list(
        indicatorId = ii, constructId = c0,
        importance = fin(wn[[c0]][[ii]] * imp[[j]]), performance = fin(perf_i[[ii]])))
    }), recursive = FALSE)
  } else {
    warnings[[length(warnings) + 1L]] <- list(code = "IPMA_INDICATOR_LEVEL_UNAVAILABLE", severity = "info",
      message = "Indicator-level IPMA is not offered for this engine by the capability registry; only construct-level results are reported.")
  }
  res$convention <- IPMA_CONVENTION

  neg <- unlist(lapply(ip$predecessors, function(c0) names(wn[[c0]])[wn[[c0]] < 0]))
  if (length(neg)) {
    warnings[[length(warnings) + 1L]] <- list(code = "IPMA_NEGATIVE_WEIGHT", severity = "warning",
      message = sprintf("%d normalized IPMA weight(s) are negative; the construct score is then not a weighted mean and its performance can fall outside 0-100.", length(neg)),
      elementIds = I(neg))
  }
  nonfin <- c(vapply(cons_out, function(x) is.na(x$importance) || is.na(x$performance), TRUE))
  if (any(nonfin)) {
    warnings[[length(warnings) + 1L]] <- list(code = "IPMA_NON_FINITE", severity = "error",
      message = "Some IPMA values could not be computed (non-finite; e.g. weights of a block summing to zero) and are null.")
  }
  if (!is.null(spec$bootstrap)) {
    warnings[[length(warnings) + 1L]] <- list(code = "IPMA_NO_INTERVALS", severity = "info",
      message = "IPMA importance and performance are point estimates in this version (no bootstrap intervals).")
  }
  list(result = res, warnings = warnings,
       call = call_text("fit_ipma <- cSEM::csem", c(".data = data_rescaled_0_100", ".model = model"), opts))
}
