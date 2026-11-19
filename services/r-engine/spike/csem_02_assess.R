# Phase 0 spike - cSEM assess(): every quality criterion (task item e).
#
# For each estimation flavour of tam-v1 (PLSc, classic Mode A, Mode B composites,
# mixed) this script
#   1. calls assess() once per accepted .quality_criterion value and records
#      whether it runs and what it returns,
#   2. dumps the full numeric output,
#   3. recomputes the important criteria from first principles (textbook
#      formulas on the indicator correlation matrix) and records the max
#      absolute difference. A criterion is "verified" only when (3) agrees.
#
# Evidence: docs/validation/phase-0/evidence/r/csem_assess.json

source(file.path(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "_common.R"))
suppressPackageStartupMessages(library(cSEM))

d <- load_tam()
n <- nrow(d)
TOL <- 1e-10
objs <- list(
  plsc      = csem(d, tam_model_syntax("=~"), .tolerance = TOL),
  classicA  = csem(d, tam_model_syntax("=~"), .disattenuate = FALSE, .tolerance = TOL),
  compositeB = csem(d, tam_model_syntax("<~"), .tolerance = TOL),
  mixed     = csem(d, tam_model_syntax(c(PU = "<~", PEOU = "<~", ATU = "=~", BI = "=~", USE = "=~")), .tolerance = TOL)
)
cons <- names(TAM_BLOCKS)
find <- list()

crit_values <- eval(formals(assess)$.quality_criterion)
find$api <- list(
  assess_formals = formals_of(assess),
  quality_criterion_values = crit_values,
  dotdotdot_arguments = c(".absolute", ".alpha", ".ci", ".closed_form_ci", ".handle_inadmissibles", ".inference",
                          ".null_model", ".R", ".saturated", ".seed", ".type_gfi", ".type_vcv"),
  calculate_functions_exported = grep("^calculate", getNamespaceExports("cSEM"), value = TRUE)
)

# ---- 1. which criteria run, per object ------------------------------------------
summarise_value <- function(x) {
  if (is.null(x)) return(list(kind = "NULL"))
  if (is.matrix(x)) return(list(kind = "matrix", dim = dim(x), all_na = all(is.na(x))))
  if (is.data.frame(x)) return(list(kind = "data.frame", dim = dim(x)))
  if (is.list(x)) return(list(kind = "list", names = names(x)))
  list(kind = class(x)[1], length = length(x), names = names(x), all_na = length(x) > 0 && all(is.na(x)))
}
find$per_criterion <- lapply(stats::setNames(nm = setdiff(crit_values, "all")), function(q) {
  lapply(objs, function(o) {
    tc <- try_capture(assess(o, .quality_criterion = q))
    status_of(tc, function(v) {
      v <- v[setdiff(names(v), "Information")]
      list(returned = names(v), values = lapply(v, summarise_value))
    })
  })
})

# ---- 2. full dump ------------------------------------------------------------------
dump_assess <- function(a) {
  out <- list()
  for (k in setdiff(names(a), "Information")) {
    x <- a[[k]]
    out[[k]] <- if (is.matrix(x)) mat_named(x)
    else if (k %in% c("HTMT", "HTMT2")) list(htmts = if (is.matrix(x$htmts)) mat_named(x$htmts) else x$htmts,
                                             inference = x$inference, absolute = x$absolute, ci = x$ci)
    else if (k == "Effects") lapply(x, function(e) df_rows(e[, c("Name", "Estimate")]))
    else if (k == "Reliability") lapply(x, vec_named)
    else if (is.numeric(x) && !is.null(names(x))) vec_named(x)
    else x
  }
  out
}
all_assess <- lapply(objs, function(o) try_capture(assess(o)))
find$all <- lapply(all_assess, function(tc) status_of(tc, dump_assess))
find$all_only_common_factors_false <- lapply(objs[c("compositeB", "mixed")], function(o) {
  status_of(try_capture(assess(o, .only_common_factors = FALSE)), dump_assess)
})

# ---- 3. first-principles recomputation ----------------------------------------------
ind_all <- unlist(TAM_BLOCKS, use.names = FALSE)
S <- stats::cor(d[, ind_all])

first_principles <- function(o, a) {
  L <- o$Estimates$Loading_estimates[cons, ind_all]
  W <- o$Estimates$Weight_estimates[cons, ind_all]
  P <- o$Estimates$Construct_VCV[cons, cons]
  lam <- lapply(TAM_BLOCKS, function(b) L[names(TAM_BLOCKS)[sapply(TAM_BLOCKS, identical, b)], b])
  ave <- sapply(lam, function(l) mean(l^2))
  rho_c <- sapply(lam, function(l) sum(l)^2 / (sum(l)^2 + sum(1 - l^2)))
  alpha_std <- sapply(TAM_BLOCKS, function(b) { k <- length(b); rb <- mean(S[b, b][lower.tri(S[b, b])]); k * rb / (1 + (k - 1) * rb) })
  Cv <- stats::cov(d[, ind_all])
  alpha_raw <- sapply(TAM_BLOCKS, function(b) { k <- length(b); k / (k - 1) * (1 - sum(diag(Cv[b, b])) / sum(Cv[b, b])) })
  rho_a <- sapply(names(TAM_BLOCKS), function(k) {
    b <- TAM_BLOCKS[[k]]; w <- W[k, b]; Sb <- S[b, b]; ww <- tcrossprod(w)
    sum(w^2)^2 * drop(t(w) %*% (Sb - diag(diag(Sb))) %*% w) / drop(t(w) %*% (ww - diag(diag(ww))) %*% w)
  })
  htmt <- function(geometric) {
    M <- matrix(NA_real_, length(cons), length(cons), dimnames = list(cons, cons))
    avg <- if (geometric) function(v) exp(mean(log(v))) else mean
    for (i in cons) for (j in cons) if (i != j) {
      bi <- TAM_BLOCKS[[i]]; bj <- TAM_BLOCKS[[j]]
      het <- avg(abs(S[bi, bj]))
      mi <- avg(abs(S[bi, bi][lower.tri(S[bi, bi])])); mj <- avg(abs(S[bj, bj][lower.tri(S[bj, bj])]))
      M[i, j] <- het / sqrt(mi * mj)
    }
    M
  }
  r2 <- sapply(names(TAM_STRUCT), function(to) { p <- TAM_STRUCT[[to]]; sum(solve(P[p, p, drop = FALSE], P[p, to]) * P[p, to]) })
  r2_adj <- sapply(names(TAM_STRUCT), function(to) 1 - (1 - r2[[to]]) * (n - 1) / (n - length(TAM_STRUCT[[to]]) - 1))
  f2 <- do.call(rbind, lapply(names(TAM_STRUCT), function(to) {
    p <- TAM_STRUCT[[to]]
    do.call(rbind, lapply(p, function(x) {
      rest <- setdiff(p, x)
      r2_ex <- if (length(rest)) sum(solve(P[rest, rest, drop = FALSE], P[rest, to]) * P[rest, to]) else 0
      data.frame(to = to, from = x, f2 = (r2[[to]] - r2_ex) / (1 - r2[[to]]))
    }))
  }))
  vif <- do.call(rbind, lapply(names(TAM_STRUCT), function(to) {
    p <- TAM_STRUCT[[to]]
    if (length(p) < 2) return(NULL)
    data.frame(to = to, from = p, vif = diag(solve(P[p, p])))
  }))
  vif_ind <- unlist(unname(lapply(TAM_BLOCKS, function(b) stats::setNames(diag(solve(S[b, b])), b))))
  Sig <- fit(o)[ind_all, ind_all]
  Dm <- S - Sig
  ev <- Re(eigen(solve(S) %*% Sig)$values)
  list(ave = ave, rho_c = rho_c, alpha_std = alpha_std, alpha_raw = alpha_raw, rho_a = rho_a,
       htmt = htmt(FALSE), htmt2 = htmt(TRUE), r2 = r2, r2_adj = r2_adj, f2 = f2, vif = vif, vif_ind = vif_ind,
       fl_offdiag = P^2,
       srmr_lower_incl_diag = sqrt(sum(Dm[lower.tri(Dm, diag = TRUE)]^2) / sum(lower.tri(Dm, diag = TRUE))),
       srmr_lower_excl_diag = sqrt(mean(Dm[lower.tri(Dm)]^2)),
       d_uls = 0.5 * sum(Dm^2), d_uls_lower_only = sum(Dm[lower.tri(Dm)]^2),
       d_g_log10 = 0.5 * sum(log10(ev)^2), d_g_ln = 0.5 * sum(log(ev)^2),
       d_ml = log(det(Sig)) - log(det(S)) + sum(diag(S %*% solve(Sig))) - ncol(S),
       gof = sqrt(mean(unlist(lam)^2) * mean(o$Estimates$R2)),
       Sigma_hat = Sig)
}

check_object <- function(nm) {
  o <- objs[[nm]]
  a <- all_assess[[nm]]$value
  fp <- first_principles(o, a)
  cf <- names(which(o$Information$Model$construct_type == "Common factor"))
  lower <- function(M, keep) { M <- M[keep, keep, drop = FALSE]; M[lower.tri(M)] }
  # cSEM returns HTMT as a lower-triangular matrix in ITS construct order (zeros above the diagonal)
  sym <- function(M) { M2 <- M + t(M); diag(M2) <- diag(M); M2 }
  out <- list(common_factor_constructs = cf)
  if (length(cf)) {
    g <- function(v) v[cf]
    out$AVE_vs_mean_squared_loading <- max_abs_diff(g(a$AVE), g(fp$ave))
    out$RhoC_vs_joereskog_formula_on_object_loadings <- max_abs_diff(g(a$RhoC), g(fp$rho_c))
    out$RhoC_mm_vs_joereskog_formula <- max_abs_diff(g(a$RhoC_mm), g(fp$rho_c))
    out$RhoC_weighted_vs_dijkstra_henseler_rhoA_formula <- max_abs_diff(g(a$RhoC_weighted), g(fp$rho_a))
    out$RhoC_weighted_mm_vs_rhoA_formula <- max_abs_diff(g(a$RhoC_weighted_mm), g(fp$rho_a))
    out$Reliability_rhoA_vs_rhoA_formula <- max_abs_diff(g(a$Reliability[["Dijkstra-Henselers_rho_A"]]), g(fp$rho_a))
    out$Reliability_joereskog_vs_formula <- max_abs_diff(g(a$Reliability$Joereskogs_rho), g(fp$rho_c))
    out$Reliability_alpha_vs_standardised_alpha <- max_abs_diff(g(a$Reliability$Cronbachs_alpha), g(fp$alpha_std))
    out$RhoT_vs_standardised_alpha <- max_abs_diff(g(a$RhoT), g(fp$alpha_std))
    out$RhoT_vs_raw_covariance_alpha <- max_abs_diff(g(a$RhoT), g(fp$alpha_raw))
    out$Estimates_Reliabilities_vs_rhoA_formula <- max_abs_diff(o$Estimates$Reliabilities[cf], fp$rho_a[cf])
  }
  if (length(cf) >= 2) {
    out$HTMT_vs_formula <- max_abs_diff(lower(sym(a$HTMT$htmts), cf), lower(fp$htmt, cf))
    out$HTMT2_vs_formula <- max_abs_diff(lower(sym(a$HTMT2$htmts), cf), lower(fp$htmt2, cf))
    FL <- a[["Fornell-Larcker"]]
    out$FL_offdiag_vs_squared_construct_cor <- max_abs_diff(lower(FL, cf), lower(fp$fl_offdiag, cf))
    out$FL_diag_vs_AVE <- max_abs_diff(diag(FL[cf, cf, drop = FALSE]), fp$ave[cf])
  }
  out$R2_vs_formula <- max_abs_diff(a$R2[names(fp$r2)], fp$r2)
  out$R2_adj_vs_formula <- max_abs_diff(a$R2_adj[names(fp$r2_adj)], fp$r2_adj)
  out$F2_vs_formula <- max_abs_diff(mapply(function(to, from) a$F2[to, from], fp$f2$to, fp$f2$from), fp$f2$f2)
  V <- o$Estimates$VIF
  out$Estimates_VIF_structure <- list(class = class(V), names = names(V), element = lapply(V, function(v) as.list(v)))
  out$structural_VIF_vs_formula <- max_abs_diff(mapply(function(to, from) V[[to]][[from]], fp$vif$to, fp$vif$from), fp$vif$vif)
  out$assess_VIF_colnames <- colnames(a$VIF)
  if (!is.null(a$VIF_modeB)) {
    vm <- a$VIF_modeB
    got <- unlist(lapply(rownames(vm), function(k) stats::setNames(vm[k, TAM_BLOCKS[[k]]], TAM_BLOCKS[[k]])))
    out$VIF_modeB_rows <- rownames(vm)
    out$VIF_modeB_vs_within_block_indicator_vif <- max_abs_diff(got, fp$vif_ind[names(got)])
  }
  out$SRMR_vs_lower_triangle_incl_diag <- abs(a$SRMR - fp$srmr_lower_incl_diag)
  out$SRMR_vs_lower_triangle_excl_diag <- abs(a$SRMR - fp$srmr_lower_excl_diag)
  out$DL_vs_half_sum_squared_all_elements <- abs(a$DL - fp$d_uls)
  out$DL_vs_sum_squared_lower_triangle <- abs(a$DL - fp$d_uls_lower_only)
  out$DG_vs_log10_formula <- abs(a$DG - fp$d_g_log10)
  out$DG_vs_natural_log_formula <- abs(a$DG - fp$d_g_ln)
  out$DG_natural_log_value <- fp$d_g_ln
  out$DML_vs_formula <- abs(a$DML - fp$d_ml)
  out$Chi_square_vs_n_minus_1_times_DML <- abs(a$Chi_square - (n - 1) * a$DML)
  out$Chi_square_df_vs_ratio <- abs(a$Chi_square_df - a$Chi_square / a$Df)
  out$RMSEA_vs_formula <- abs(a$RMSEA - sqrt(max(0, (a$Chi_square / a$Df - 1) / (n - 1))))
  out$GoF_vs_formula <- abs(a$GoF - fp$gof)
  out$Df <- a$Df
  out$model_implied_matrix_diag_minus_1 <- max(abs(diag(fp$Sigma_hat) - 1))
  out$srmr_saturated <- calculateSRMR(o, .saturated = TRUE)
  out$srmr_estimated <- calculateSRMR(o, .saturated = FALSE)
  out
}
find$first_principles_max_abs_diff <- lapply(stats::setNames(nm = names(objs)), check_object)

# rho_A for a classic (non-disattenuated) Mode A run: assess() does NOT return it.
pl <- objs$plsc; cl <- objs$classicA
a_cl <- all_assess$classicA$value; a_pl <- all_assess$plsc$value
find$rhoA_for_classic_modeA <- list(
  problem = "On a '=~' model estimated with .disattenuate = FALSE, Estimates$Reliabilities are all 1, RhoC_weighted is all 1 and Reliability$'Dijkstra-Henselers_rho_A' is not Dijkstra-Henseler's rho_A.",
  classic_assess_RhoC_weighted = vec_named(a_cl$RhoC_weighted),
  classic_assess_Reliability_rhoA = vec_named(a_cl$Reliability[["Dijkstra-Henselers_rho_A"]]),
  classic_assess_Reliability_joereskog = vec_named(a_cl$Reliability$Joereskogs_rho),
  classic_assess_RhoC = vec_named(a_cl$RhoC),
  plsc_Estimates_Reliabilities = vec_named(pl$Estimates$Reliabilities),
  weights_identical_between_runs = max_abs_diff(pl$Estimates$Weight_estimates, cl$Estimates$Weight_estimates),
  recipe = "rho_A (and Cronbach's alpha) are functions of the Mode A weights and S only, and the weights are identical in the PLSc and the classic run. Take rho_A from csem(.disattenuate = TRUE)$Estimates$Reliabilities; take rho_C and AVE for classic PLS from assess(<classic object>)$RhoC and $AVE (classic loadings)."
)

# HTMT with bootstrap inference (smoke) -----------------------------------------------
tc <- try_capture(assess(objs$plsc, .quality_criterion = "htmt", .inference = "bootstrap", .R = 60, .seed = 11, .alpha = 0.05))
find$htmt_inference_smoke <- status_of(tc, function(v) list(
  names = names(v$HTMT), inference = v$HTMT$inference, ci = v$HTMT$ci, nr_admissibles = v$HTMT$nr_admissibles,
  quantiles_dim = dim(v$HTMT$quantiles), quantiles_dimnames = dimnames(v$HTMT$quantiles),
  quantiles = if (is.matrix(v$HTMT$quantiles)) mat_named(v$HTMT$quantiles) else v$HTMT$quantiles
))
tc <- try_capture(assess(objs$plsc, .quality_criterion = "htmt", .absolute = FALSE))
find$htmt_absolute_false <- status_of(tc, function(v) list(
  max_abs_diff_vs_absolute_true = max_abs_diff(v$HTMT$htmts, all_assess$plsc$value$HTMT$htmts)))

write_evidence("csem_assess", find, packages = c("cSEM"))
