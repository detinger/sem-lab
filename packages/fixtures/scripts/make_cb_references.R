# CB-SEM reference results for the browser engine, produced by lavaan (the verified oracle).
#
# For each CB-capable synthetic fixture and variant (ML marker, ML std.lv, MLR, FIML), fits
# lavaan::sem() and writes packages/fixtures/reference-results/cb/<case>__<variant>.json with
# unstandardised and standardised estimates, SEs, fit measures, convergence and post.check.
# Syntax uses aliases (F1.., V1..) built from model ids; user labels never enter R code.
#
# Run: services/r-engine/bin/rscript packages/fixtures/scripts/make_cb_references.R

suppressPackageStartupMessages({ library(lavaan); library(jsonlite) })

root <- normalizePath(file.path(dirname(sub("--file=", "", grep("--file=", commandArgs(FALSE), value = TRUE))), "..", "..", ".."))
syn <- file.path(root, "packages", "fixtures", "synthetic")
out_dir <- file.path(root, "packages", "fixtures", "reference-results", "cb")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

FIT <- c("chisq", "df", "pvalue", "cfi", "tli", "rmsea", "rmsea.ci.lower", "rmsea.ci.upper", "srmr",
         "aic", "bic", "logl", "npar", "chisq.scaled", "cfi.robust", "tli.robust", "rmsea.robust", "srmr_bentler")

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

run_variant <- function(case, variant, estimator = "ML", std_lv = FALSE, missing = "listwise") {
  model <- fromJSON(file.path(syn, case, "model.json"), simplifyVector = FALSE)
  raw <- read.csv(file.path(syn, case, "data.csv"), check.names = FALSE)
  b <- build(model)
  d <- raw[, unname(b$col), drop = FALSE]
  names(d) <- names(b$col)            # indicator ids
  names(d) <- unname(b$v[names(d)])   # aliases
  warns <- character()
  fit <- withCallingHandlers(
    sem(b$syntax, data = d, estimator = estimator, std.lv = std_lv, missing = missing, meanstructure = missing == "ml"),
    warning = function(w) { warns <<- c(warns, conditionMessage(w)); invokeRestart("muffleWarning") })
  rev_alias <- c(setNames(names(b$f), b$f), setNames(names(b$v), b$v))
  ids <- function(x) unname(ifelse(x %in% names(rev_alias), rev_alias[x], x))
  pe <- parameterEstimates(fit, ci = FALSE)
  ss <- standardizedSolution(fit, se = FALSE)
  converged <- lavInspect(fit, "converged")
  fm <- if (converged) tryCatch(fitMeasures(fit, FIT[FIT %in% names(fitMeasures(fit, "all"))]), error = function(e) NULL) else NULL
  post <- tryCatch(lavInspect(fit, "post.check"), warning = function(w) FALSE, error = function(e) NA)
  res <- list(
    case = case, variant = variant,
    options = list(estimator = estimator, std.lv = std_lv, missing = missing, meanstructure = missing == "ml",
                   lavaan = as.character(packageVersion("lavaan")), R = paste(R.version$major, R.version$minor, sep = ".")),
    syntax_aliases = b$syntax, n_used = lavInspect(fit, "nobs"), n_rows = nrow(d),
    converged = converged, post_check = isTRUE(post), warnings = I(warns),
    parameters = data.frame(lhs = ids(pe$lhs), op = pe$op, rhs = ids(pe$rhs), est = pe$est, se = pe$se,
                            z = pe$z, pvalue = pe$pvalue, std_all = ss$est.std[match(paste(pe$lhs, pe$op, pe$rhs), paste(ss$lhs, ss$op, ss$rhs))]),
    fit = if (is.null(fm)) NULL else as.list(unclass(fm))
  )
  path <- file.path(out_dir, sprintf("%s__%s.json", case, variant))
  writeLines(toJSON(res, digits = I(17), auto_unbox = TRUE, na = "null", null = "null", pretty = TRUE, dataframe = "rows"), path)
  cat(sprintf("%-6s %s__%s  converged=%s post.check=%s warnings=%d\n", if (converged) "ok" else "NOCONV", case, variant, converged, isTRUE(post), length(warns)))
}

for (case in c("cfa-one-factor", "cfa-two-factor", "cfa-two-factor-exact", "tam-mediation-exact", "service-quality", "cb-heywood-exact")) {
  run_variant(case, "ml-marker")
  run_variant(case, "ml-stdlv", std_lv = TRUE)
}
for (case in c("cfa-two-factor", "service-quality")) run_variant(case, "mlr-marker", estimator = "MLR")
run_variant("missing-mcar", "ml-listwise")
run_variant("missing-mcar", "ml-fiml", missing = "ml")
run_variant("missing-mcar", "mlr-fiml", estimator = "MLR", missing = "ml")
