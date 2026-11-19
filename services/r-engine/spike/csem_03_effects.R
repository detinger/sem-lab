# Phase 0 spike - cSEM direct / indirect / total effects (task item f).
#
# Evidence: docs/validation/phase-0/evidence/r/csem_effects.json

source(file.path(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "_common.R"))
suppressPackageStartupMessages(library(cSEM))

d <- load_tam()
cons <- names(TAM_BLOCKS)
find <- list()

effects_check <- function(res) {
  a <- assess(res, .quality_criterion = "effects")$Effects
  s <- summarize(res)$Estimates$Effect_estimates
  B <- res$Estimates$Path_estimates[cons, cons]            # B[to, from]
  I <- diag(length(cons))
  total_own <- solve(I - B) - I                              # (I - B)^-1 - I, recursive model
  indirect_own <- total_own - B
  as_mat <- function(df) {
    M <- matrix(0, length(cons), length(cons), dimnames = list(cons, cons))
    sp <- strsplit(df$Name, " ~ ", fixed = TRUE)
    for (i in seq_along(sp)) M[sp[[i]][1], sp[[i]][2]] <- df$Estimate[i]
    M
  }
  D <- as_mat(a$Direct_effect); IN <- as_mat(a$Indirect_effect); TT <- as_mat(a$Total_effect)

  # specific indirect effects: enumerate every directed path of length >= 2
  walk <- function(from, to, via = character(0)) {
    out <- list()
    for (nx in cons[B[, from] != 0]) {
      if (nx == to) { if (length(via)) out[[length(out) + 1]] <- c(via, to) }
      else out <- c(out, walk(nx, to, c(via, nx)))
    }
    out
  }
  specific <- do.call(rbind, lapply(cons, function(from) do.call(rbind, lapply(cons, function(to) {
    if (from == to) return(NULL)
    paths <- walk(from, to)
    if (!length(paths)) return(NULL)
    do.call(rbind, lapply(paths, function(p) {
      nodes <- c(from, p)
      est <- prod(mapply(function(a_, b_) B[b_, a_], nodes[-length(nodes)], nodes[-1]))
      data.frame(from = from, to = to, path = paste(nodes, collapse = " -> "), est = est, stringsAsFactors = FALSE)
    }))
  }))))
  spec_sum <- stats::aggregate(est ~ from + to, data = specific, FUN = sum)
  vaf <- a$Variance_accounted_for
  vaf_own <- mapply(function(nm) { sp <- strsplit(nm, " ~ ", fixed = TRUE)[[1]]; indirect_own[sp[1], sp[2]] / total_own[sp[1], sp[2]] }, vaf$Name)
  list(
    where = list(
      assess = "assess(res, .quality_criterion = 'effects')$Effects$<Direct_effect|Indirect_effect|Total_effect|Variance_accounted_for> (data.frame: Name = 'to ~ from', Estimate)",
      summarize = "summarize(res)$Estimates$Effect_estimates$<same four>",
      resampled = "res$Estimates$Estimates_resample$Estimates1$<Indirect_effect|Total_effect>$<Resampled|Original>",
      direct_is = "res$Estimates$Path_estimates[to, from]"
    ),
    names_in_assess = names(a),
    names_in_summarize = names(s),
    direct = df_rows(a$Direct_effect[, c("Name", "Estimate")]),
    indirect = df_rows(a$Indirect_effect[, c("Name", "Estimate")]),
    total = df_rows(a$Total_effect[, c("Name", "Estimate")]),
    variance_accounted_for = df_rows(vaf[, c("Name", "Estimate")]),
    specific_indirect_own = specific,
    checks_max_abs_diff = list(
      total_minus_direct_minus_indirect = max(abs(TT - D - IN)),
      direct_vs_path_estimates = max(abs(D - B)),
      total_vs_own_matrix_formula = max(abs(TT - total_own)),
      indirect_vs_own_matrix_formula = max(abs(IN - indirect_own)),
      indirect_vs_sum_of_specific_path_products = max(abs(mapply(function(f, t, e) IN[t, f] - e, spec_sum$from, spec_sum$to, spec_sum$est))),
      assess_vs_summarize_total = max_abs_diff(a$Total_effect$Estimate, s$Total_effect$Estimate),
      vaf_vs_indirect_over_total = max_abs_diff(vaf$Estimate, vaf_own)
    ),
    notes = list(
      total_effect_table_lists_only_nonzero_pairs = nrow(a$Total_effect),
      indirect_effect_table_rows = nrow(a$Indirect_effect),
      specific_indirect_effects_provided_by_cSEM = FALSE,
      specific_indirect_note = "cSEM returns only the TOTAL indirect effect per (from, to) pair. Specific indirect effects (one per mediating chain) must be computed by us as products of path coefficients - on the point estimate and, for inference, on every bootstrap draw of the path coefficients."
    )
  )
}

find$classic_modeA <- effects_check(csem(d, tam_model_syntax("=~"), .disattenuate = FALSE, .tolerance = 1e-10))
find$plsc <- effects_check(csem(d, tam_model_syntax("=~"), .tolerance = 1e-10))

# Bootstrap consistency: are the resampled indirect/total effects functions of the resampled paths?
rb <- csem(d, tam_model_syntax("=~"), .disattenuate = FALSE, .resample_method = "bootstrap", .R = 40, .seed = 2024)
e1 <- rb$Estimates$Estimates_resample$Estimates1
P <- e1$Path_estimates$Resampled
Tt <- e1$Total_effect$Resampled
In <- e1$Indirect_effect$Resampled
own_total <- t(apply(P, 1, function(p) {
  B <- matrix(0, length(cons), length(cons), dimnames = list(cons, cons))
  sp <- strsplit(colnames(P), " ~ ", fixed = TRUE)
  for (i in seq_along(sp)) B[sp[[i]][1], sp[[i]][2]] <- p[i]
  Tm <- solve(diag(length(cons)) - B) - diag(length(cons))
  sapply(strsplit(colnames(Tt), " ~ ", fixed = TRUE), function(x) Tm[x[1], x[2]])
}))
find$bootstrap_effects <- list(
  path_draws_dim = dim(P), path_draw_colnames = colnames(P),
  total_draws_dim = dim(Tt), total_draw_colnames = colnames(Tt),
  indirect_draws_dim = dim(In), indirect_draw_colnames = colnames(In),
  total_draws_vs_recomputed_from_path_draws = max(abs(Tt - own_total)),
  conclusion = "Per-draw total (and hence specific indirect) effects can be recomputed from the raw path draws alone; SEM Studio only needs to store the path draw matrix."
)

write_evidence("csem_effects", find, packages = c("cSEM"))
