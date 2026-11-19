# Supplementary reference values for the browser CB-SEM engine (packages/engine/src/cb).
#
# 1. fit-measures.json — the complete lavaan::fitMeasures() vector for every case/variant
#    produced by make_cb_references.R. (In those files `fit` is empty: in
#    `FIT[FIT %in% fitMeasures(fit, "all") |> names()]` the pipe binds before %in%, so the
#    selection is always empty. This script fits the identical models and stores all fit
#    measures here instead of editing the committed reference files.)
# 2. distributions.json — pchisq (central and noncentral), qchisq, pnorm values and lavaan's
#    RMSEA confidence limits (lav_fit_rmsea_ci) for a grid of (X2, df, N), used to test the
#    TypeScript distribution functions and the uniroot emulation.
# 3. diagnostics.json — how lavaan reacts to the degenerate fixtures (cb-singular).
#
# Run: services/r-engine/bin/rscript packages/fixtures/scripts/make_cb_math_references.R

suppressPackageStartupMessages({ library(lavaan); library(jsonlite) })

root <- normalizePath(file.path(dirname(sub("--file=", "", grep("--file=", commandArgs(FALSE), value = TRUE))), "..", "..", ".."))
syn <- file.path(root, "packages", "fixtures", "synthetic")
out_dir <- file.path(root, "packages", "fixtures", "reference-results", "cb-math")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
write_json17 <- function(x, name) {
  writeLines(toJSON(x, digits = I(17), auto_unbox = TRUE, na = "null", null = "null", pretty = TRUE),
             file.path(out_dir, name))
}

# Same alias syntax as make_cb_references.R (ids -> F1.., V1..).
build <- function(model) {
  cons <- model$constructs
  f_alias <- setNames(paste0("F", seq_along(cons)), vapply(cons, `[[`, "", "id"))
  ind_ids <- unique(unlist(lapply(cons, function(c) unlist(c$indicatorIds))))
  v_alias <- setNames(paste0("V", seq_along(ind_ids)), ind_ids)
  col_of <- setNames(vapply(model$indicators, function(i) i$column, ""), vapply(model$indicators, `[[`, "", "id"))
  lines <- vapply(cons, function(c) paste(f_alias[[c$id]], "=~", paste(v_alias[unlist(c$indicatorIds)], collapse = " + ")), "")
  rels <- model$relationships
  st <- Filter(function(r) r$kind == "structural", rels)
  for (t in unique(vapply(st, `[[`, "", "targetId"))) {
    src <- vapply(Filter(function(r) r$targetId == t, st), `[[`, "", "sourceId")
    lines <- c(lines, paste(f_alias[[t]], "~", paste(f_alias[src], collapse = " + ")))
  }
  for (r in Filter(function(r) r$kind == "covariance", rels)) {
    a <- c(f_alias, v_alias)
    lines <- c(lines, paste(a[[r$sourceId]], "~~", a[[r$targetId]]))
  }
  list(syntax = paste(lines, collapse = "\n"), f = f_alias, v = v_alias, col = col_of[ind_ids])
}

fit_case <- function(case, estimator = "ML", std_lv = FALSE, missing = "listwise", ...) {
  model <- fromJSON(file.path(syn, case, "model.json"), simplifyVector = FALSE)
  raw <- read.csv(file.path(syn, case, "data.csv"), check.names = FALSE)
  b <- build(model)
  d <- raw[, unname(b$col), drop = FALSE]
  names(d) <- unname(b$v[names(b$col)])
  suppressWarnings(sem(b$syntax, data = d, estimator = estimator, std.lv = std_lv, missing = missing,
                       meanstructure = missing == "ml", ...))
}

variants <- list()
for (case in c("cfa-one-factor", "cfa-two-factor", "cfa-two-factor-exact", "tam-mediation-exact", "service-quality", "cb-heywood-exact")) {
  variants[[paste0(case, "__ml-marker")]] <- list(case, "ML", FALSE, "listwise")
  variants[[paste0(case, "__ml-stdlv")]] <- list(case, "ML", TRUE, "listwise")
}
for (case in c("cfa-two-factor", "service-quality")) variants[[paste0(case, "__mlr-marker")]] <- list(case, "MLR", FALSE, "listwise")
variants[["missing-mcar__ml-listwise"]] <- list("missing-mcar", "ML", FALSE, "listwise")
variants[["missing-mcar__ml-fiml"]] <- list("missing-mcar", "ML", FALSE, "ml")
variants[["missing-mcar__mlr-fiml"]] <- list("missing-mcar", "MLR", FALSE, "ml")

fits <- list()
tight <- list()
for (k in names(variants)) {
  v <- variants[[k]]
  fit <- fit_case(v[[1]], v[[2]], v[[3]], v[[4]])
  fm <- fitMeasures(fit)
  fits[[k]] <- as.list(unclass(fm))
  # Tightly converged refit: lavaan's default nlminb stops at rel.tol 1e-10 on the objective,
  # which leaves parameter errors up to ~1e-6. BFGS with reltol 1e-20, restarted from the
  # default solution, reaches max |gradient| ~1e-9 (the same lavaan objective and options).
  ft <- fit_case(v[[1]], v[[2]], v[[3]], v[[4]], start = fit, optim.method = "BFGS", control = list(reltol = 1e-20, maxit = 10000))
  ft <- fit_case(v[[1]], v[[2]], v[[3]], v[[4]], start = ft, optim.method = "BFGS", control = list(reltol = 1e-20, maxit = 10000))
  model <- fromJSON(file.path(syn, v[[1]], "model.json"), simplifyVector = FALSE)
  b <- build(model)
  rev_alias <- c(setNames(names(b$f), b$f), setNames(names(b$v), b$v))
  ids <- function(x) unname(ifelse(x %in% names(rev_alias), rev_alias[x], x))
  pe <- parameterEstimates(ft, ci = FALSE)
  ss <- standardizedSolution(ft, se = FALSE)
  tight[[k]] <- list(
    gradient_max_default = max(abs(lavInspect(fit, "gradient"))),
    gradient_max_tight = max(abs(lavInspect(ft, "gradient"))),
    max_est_change = max(abs(coef(ft) - coef(fit))),
    parameters = data.frame(lhs = ids(pe$lhs), op = pe$op, rhs = ids(pe$rhs), est = pe$est, se = pe$se,
                            std_all = ss$est.std[match(paste(pe$lhs, pe$op, pe$rhs), paste(ss$lhs, ss$op, ss$rhs))]),
    fit = as.list(unclass(fitMeasures(ft))))
  cat(sprintf("%-40s chisq=%.6f df=%d  grad default %.1e tight %.1e  max est change %.1e\n", k, fm[["chisq"]],
              as.integer(fm[["df"]]), tight[[k]]$gradient_max_default, tight[[k]]$gradient_max_tight, tight[[k]]$max_est_change))
}
write_json17(list(lavaan = as.character(packageVersion("lavaan")), fits = fits), "fit-measures.json")
writeLines(toJSON(list(lavaan = as.character(packageVersion("lavaan")), fits = tight), digits = I(17), auto_unbox = TRUE,
                  na = "null", null = "null", pretty = TRUE, dataframe = "rows"),
           file.path(out_dir, "tight-refits.json"))

# ---- distributions
grid <- expand.grid(q = c(0.5, 3, 12.5, 20.744616, 40, 120), df = c(1, 4, 19, 28, 41), ncp = c(0, 0.3, 5, 17.25, 60))
grid$p <- pchisq(grid$q, grid$df, ncp = grid$ncp)
central <- expand.grid(q = c(0.01, 1, 17.018767, 20.744616, 100, 740.88, 1321.8), df = c(1, 5, 19, 28, 41))
central$upper <- pchisq(central$q, central$df, lower.tail = FALSE)
central$lower <- pchisq(central$q, central$df)
z <- c(0, 0.5, 1.96, 3.532007, 6.458412, 8.5, 12, 30)
norm <- data.frame(z = z, upper = pnorm(z, lower.tail = FALSE), twosided_lavaan = 2 * (1 - pnorm(abs(z))))
ci_grid <- expand.grid(x2 = c(0, 5, 17.018767, 20.744616, 35, 80.5, 300), df = c(1, 8, 19, 41), n = c(200, 450, 500))
ci <- t(mapply(function(x2, df, n) unlist(lavaan:::lav_fit_rmsea_ci(x2 = x2, df = df, n = n)), ci_grid$x2, ci_grid$df, ci_grid$n))
ci_grid$lower <- ci[, "rmsea.ci.lower"]
ci_grid$upper <- ci[, "rmsea.ci.upper"]
# exact roots (tight uniroot) to separate lavaan's uniroot tolerance from distribution error
exact_root <- function(x2, df, p) {
  f <- function(l) pchisq(x2, df = df, ncp = l) - p
  if (f(0) < 0) return(0)
  uniroot(f, lower = 0, upper = max(x2, 1) * 10 + 100, tol = 1e-13)$root
}
ci_grid$lambda_lower_exact <- mapply(function(x2, df) exact_root(x2, df, 0.95), ci_grid$x2, ci_grid$df)
ci_grid$lambda_upper_exact <- mapply(function(x2, df) exact_root(x2, df, 0.05), ci_grid$x2, ci_grid$df)
write_json17(list(R = paste(R.version$major, R.version$minor, sep = "."),
                  pchisq_noncentral = grid, pchisq_central = central, pnorm = norm, rmsea_ci = ci_grid),
             "distributions.json")

# ---- diagnostics
s <- read.csv(file.path(syn, "cb-singular", "data.csv"))
msg <- tryCatch({ sem("F1 =~ s1 + s2 + s3 + s7\nF2 =~ s4 + s5 + s6\nF1 ~~ F2", data = s); "no error" },
                error = function(e) conditionMessage(e))
ev <- eigen(cov(s[, c("s1", "s2", "s3", "s7", "s4", "s5", "s6")]) * (nrow(s) - 1) / nrow(s), only.values = TRUE)$values
write_json17(list(`cb-singular` = list(lavaan_error = msg, eigenvalues_S = ev)), "diagnostics.json")
cat("done\n")
