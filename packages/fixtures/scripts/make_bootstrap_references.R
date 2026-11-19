# Bootstrap reference results for the browser PLS engine (packages/engine/src/pls/bootstrap.ts).
#
# Implements SEM Lab's bootstrap definition with cSEM::csem() per draw — the definition the
# exported R/Python scripts reproduce (it replaces cSEM's resampler and the R engine's chunked
# seeds):
#
#   set.seed(seed, kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection")
#   for (b in 1:B) {
#     idx <- sample.int(n, n, replace = TRUE)          # one RNG stream, drawn sequentially
#     fit <- cSEM::csem(data[idx, ], model, <same options as the main fit>)
#     failed       : csem() errors, the weights do not converge, or an estimate is non-finite
#     inadmissible : any cSEM::verify() check fails
#   }
#   valid draws only: se = sd (divisor B_valid - 1), t = est / se,
#   p = 2 * pt(-|t|, B_valid - 1) (one-sided: pt(-|t|, B_valid - 1), direction of the estimate),
#   percentile CI = quantile(type = 7) (one-sided: est >= 0 -> lower = q(1 - L); est < 0 -> upper = q(L)).
#   Total / total indirect / specific indirect effects are recomputed from each draw's paths.
#
# The model syntax, aliases, data loading (reverse scoring, checks), csem() options, parameter
# keys, effects and inference are taken from the R engine itself (services/r-engine/R), so the
# references use exactly the engine's definitions.
#
# Run (from the repository root):
#   services/r-engine/bin/rscript packages/fixtures/scripts/make_bootstrap_references.R
# Output: packages/fixtures/reference-results/pls-bootstrap/<case>__<method>.json

suppressPackageStartupMessages(library(jsonlite))

local({
  args <- commandArgs(trailingOnly = FALSE)
  f <- sub("^--file=", "", args[grepl("^--file=", args)][1])
  if (is.na(f)) stop("run with Rscript (services/r-engine/bin/rscript)")
  root <- normalizePath(file.path(dirname(normalizePath(f, mustWork = TRUE)), "..", "..", ".."), mustWork = TRUE)
  assign("ROOT", root, envir = globalenv())
  assign("ENGINE_DIR", file.path(root, "services", "r-engine"), envir = globalenv())
  r_dir <- file.path(root, "services", "r-engine", "R")
  for (src in c("job_errors.R", "job_io.R", "registry.R", "model_graph.R", "job_validate.R",
                "pls_alias.R", "pls_estimate.R", "pls_results.R")) {
    sys.source(file.path(r_dir, src), envir = globalenv())
  }
})

SYN <- file.path(ROOT, "packages", "fixtures", "synthetic")
OUT <- file.path(ROOT, "packages", "fixtures", "reference-results", "pls-bootstrap")
dir.create(OUT, showWarnings = FALSE, recursive = TRUE)

na_null <- function(x) if (is.null(x) || length(x) != 1L || !is.finite(x)) NULL else unname(x)

make_reference <- function(case, method, B, seed, level = 0.95, sides = "two-sided",
                           scheme = "path", n_rows = NULL, name = case) {
  model <- jsonlite::fromJSON(file.path(SYN, case, "model.json"), simplifyVector = FALSE)
  analysis <- list(
    method = method, engine = "r-csem", estimator = "pls-pm", missingData = "listwise", seed = seed,
    pls = list(innerWeighting = scheme, maxIterations = 300L, tolerance = 1e-10),
    bootstrap = list(enabled = TRUE, repetitions = B, ci = "percentile", confidenceLevel = level, sides = sides)
  )
  req <- list(protocolVersion = 1L, jobId = "bootstrap-reference", model = model, analysis = analysis,
              limits = list(maxBootstrap = 100000L, timeoutSeconds = 1800L))
  spec <- validate_request(req, load_registry())

  csv <- file.path(SYN, case, "data.csv")
  if (!is.null(n_rows)) {
    raw <- utils::read.csv(csv, colClasses = "character", check.names = FALSE)
    tmp <- tempfile(fileext = ".csv")
    utils::write.csv(raw[seq_len(n_rows), , drop = FALSE], tmp, row.names = FALSE, quote = FALSE)
    csv <- tmp
  }
  dat <- load_job_data(csv, spec)
  al <- build_aliases(spec)
  model_txt <- build_csem_model(spec, al)
  data <- alias_data(dat$X, al)
  opts <- csem_options(spec, disattenuate = method == "plsc")
  csem_on <- function(d) suppressMessages(suppressWarnings(
    do.call(cSEM::csem, c(list(.data = d, .model = model_txt), opts))))

  fit <- csem_on(data)
  stopifnot(isTRUE(fit$Information$Weight_info$Convergence_status))
  ts <- theta_spec(spec, al)
  theta <- extract_theta_fit(fit, ts)
  es <- effects_spec(spec)
  path_keys <- ts$key[ts$kind == "path"]
  eff_est <- compute_effects(matrix(theta[path_keys], 1L, dimnames = list(NULL, path_keys)), spec, es)

  n <- nrow(data)
  set.seed(seed, kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection")
  draws <- vector("list", B)
  valid <- list()
  for (b in seq_len(B)) {
    idx <- sample.int(n, n, replace = TRUE)
    state <- .Random.seed
    f <- tryCatch(csem_on(data[idx, , drop = FALSE]), error = function(e) NULL)
    stopifnot(identical(state, .Random.seed))   # csem() must not consume random numbers
    d <- list(b = b, idxSum = sum(idx))
    if (is.null(f)) {
      d$status <- "failed"; d$reason <- "error"
    } else if (!isTRUE(f$Information$Weight_info$Convergence_status)) {
      d$status <- "failed"; d$reason <- "nonconvergence"
    } else {
      th <- extract_theta_fit(f, ts)
      if (!all(is.finite(th))) {
        d$status <- "failed"; d$reason <- "non-finite"
      } else {
        v <- verify_flags(f)
        if (any(v)) {
          d$status <- "inadmissible"; d$checks <- I(names(v)[v])
        } else {
          d$status <- "ok"
          valid[[length(valid) + 1L]] <- th
        }
      }
      d$theta <- I(unname(th))
    }
    draws[[b]] <- d
  }
  V <- if (length(valid)) do.call(rbind, valid) else matrix(NA_real_, 0L, nrow(ts), dimnames = list(NULL, ts$key))
  colnames(V) <- ts$key
  eff_draws <- compute_effects(V[, path_keys, drop = FALSE], spec, es)
  boot <- spec$bootstrap

  params <- list()
  add <- function(key, kind, est, dr) {
    inf <- infer_from_draws(est, dr, boot)
    params[[length(params) + 1L]] <<- list(
      key = key, kind = kind, est = na_null(est), nValid = inf$nValid,
      se = na_null(inf$se), statistic = na_null(inf$statistic), pValue = na_null(inf$pValue),
      ciLower = na_null(inf$ciLower), ciUpper = na_null(inf$ciUpper))
  }
  for (i in seq_len(nrow(ts))) if (!ts$single[i]) add(ts$key[i], ts$kind[i], theta[[i]], V[, i])
  for (j in seq_along(es$pairs)) {
    pr <- es$pairs[[j]]
    add(sprintf("total:%s->%s", pr$source, pr$target), "total-effect", eff_est$total[1, j], eff_draws$total[, j])
  }
  for (j in seq_along(es$pairs)) {
    pr <- es$pairs[[j]]
    if (pr$has_indirect) {
      add(sprintf("indirect:%s->%s", pr$source, pr$target), "indirect-effect", eff_est$indirect[1, j], eff_draws$indirect[, j])
    }
  }
  for (j in seq_along(es$specific)) {
    add(es$specific[[j]]$key, "specific-indirect", eff_est$specific[1, j], eff_draws$specific[, j])
  }

  status <- vapply(draws, `[[`, "", "status")
  out <- list(
    description = paste(
      "SEM Lab bootstrap reference: set.seed(seed, kind = 'Mersenne-Twister', normal.kind = 'Inversion',",
      "sample.kind = 'Rejection'); for b in 1..B: idx = sample.int(n, n, replace = TRUE), cSEM::csem() on data[idx, ]",
      "with the main fit's options; failed = error / no convergence / non-finite estimate; inadmissible = cSEM::verify();",
      "se = sd(valid), t = est/se, p from t(df = B_valid - 1), CI = quantile(type = 7)."),
    generator = "packages/fixtures/scripts/make_bootstrap_references.R",
    versions = list(R = paste(R.version$major, R.version$minor, sep = "."),
                    cSEM = as.character(utils::packageVersion("cSEM"))),
    case = case, rows = n, seed = seed, B = B,
    request = list(model = model, analysis = analysis),
    csemCall = call_text("cSEM::csem", c(".data = data[idx, ]", ".model = model"), opts),
    thetaKeys = I(ts$key),
    estimate = I(unname(theta)),
    counts = list(requested = B, completed = sum(status == "ok"), failed = sum(status == "failed"),
                  inadmissible = sum(status == "inadmissible")),
    draws = draws,
    parameters = params
  )
  path <- file.path(OUT, sprintf("%s__%s.json", name, method))
  jsonlite::write_json(out, path, digits = I(17), auto_unbox = TRUE, null = "null", na = "null", pretty = FALSE)
  cat(sprintf("%-50s completed %d, failed %d, inadmissible %d\n", basename(path), out$counts$completed,
              out$counts$failed, out$counts$inadmissible))
  invisible(out)
}

SEED <- 20261119L
make_reference("tam-mediation", "pls-sem", B = 50L, seed = SEED)
make_reference("tam-mediation", "plsc", B = 50L, seed = SEED)
make_reference("pls-mixed-composite", "pls-sem", B = 50L, seed = SEED)
make_reference("delone-mclean", "pls-sem", B = 50L, seed = SEED, level = 0.9, sides = "one-sided")
# small samples: exercise failed (csem() error on a zero-variance resample, non-convergence) and
# inadmissible (every verify() check) draws
make_reference("tam-mediation", "plsc", B = 50L, seed = 7L, n_rows = 30L, name = "tam-mediation-n30")
make_reference("tam-mediation", "plsc", B = 50L, seed = 7L, n_rows = 15L, name = "tam-mediation-n15")
make_reference("tam-mediation", "pls-sem", B = 50L, seed = 3L, n_rows = 8L, name = "tam-mediation-n8")
