# Shared helpers for the R engine tests. Every engine run goes through the real entry
# point (bin/run-job) in a fresh temporary job directory, and every result.json is
# validated against the JSON Schema (via node + ajv) and the cross-field rules.

ENGINE_DIR <- local({
  e <- Sys.getenv("SEM_STUDIO_R_ENGINE_DIR", "")
  if (!nzchar(e)) e <- normalizePath(file.path(getwd(), "..", ".."), mustWork = TRUE)
  normalizePath(e, mustWork = TRUE)
})
REPO_DIR <- normalizePath(file.path(ENGINE_DIR, "..", ".."), mustWork = TRUE)
FIXTURES <- file.path(REPO_DIR, "packages", "fixtures", "synthetic")
RUN_JOB <- file.path(ENGINE_DIR, "bin", "run-job")
VALIDATOR <- file.path(ENGINE_DIR, "tests", "validate-result.mjs")
TAM_TXT <- file.path(REPO_DIR, "TEMP", "Example - TAM", "Data.txt")
EVIDENCE <- file.path(REPO_DIR, "docs", "validation", "phase-0", "evidence", "r")

suppressPackageStartupMessages({
  library(jsonlite)
})

read_json_list <- function(path) jsonlite::fromJSON(path, simplifyVector = FALSE)

fixture <- function(case) {
  dir <- file.path(FIXTURES, case)
  list(
    dir = dir,
    model = read_json_list(file.path(dir, "model.json")),
    analyses = read_json_list(file.path(dir, "analyses.json")),
    population = if (file.exists(file.path(dir, "population.json"))) read_json_list(file.path(dir, "population.json")) else NULL,
    data = file.path(dir, "data.csv")
  )
}

fixture_analysis <- function(fx, id) {
  for (a in fx$analyses) if (identical(a$id, id)) return(a$analysis)
  stop("no analysis ", id)
}

pls_analysis <- function(method = "pls-sem", scheme = "path", tol = 1e-10, iter = 300L, bootstrap = NULL, seed = NULL) {
  a <- list(method = method, engine = "r-csem", estimator = "pls-pm", missingData = "listwise",
            pls = list(innerWeighting = scheme, maxIterations = iter, tolerance = tol))
  if (!is.null(bootstrap)) {
    a$bootstrap <- utils::modifyList(list(enabled = TRUE, repetitions = 200L, ci = "percentile",
                                          confidenceLevel = 0.95, sides = "two-sided"), bootstrap)
    a$seed <- if (is.null(seed)) 20261119L else seed
  }
  a
}

#' Create a job directory. `data` is a path to a CSV or a data.frame.
make_job <- function(model, analysis, data, limits = list(maxBootstrap = 10000L, timeoutSeconds = 1800L),
                     request_override = NULL) {
  dir <- tempfile("job-")
  dir.create(dir)
  req <- list(protocolVersion = 1L, jobId = basename(dir), model = model, analysis = analysis, limits = limits)
  if (!is.null(request_override)) req <- utils::modifyList(req, request_override)
  writeLines(jsonlite::toJSON(req, auto_unbox = TRUE, digits = NA, null = "null"), file.path(dir, "request.json"), useBytes = TRUE)
  if (is.character(data)) {
    file.copy(data, file.path(dir, "data.csv"))
  } else {
    utils::write.csv(data, file.path(dir, "data.csv"), row.names = FALSE, na = "", fileEncoding = "UTF-8")
  }
  dir
}

#' Run the engine on a job directory; returns exit status, parsed result.json,
#' progress lines and the technical log (stderr).
run_engine <- function(dir) {
  log <- file.path(dir, "engine.log")
  status <- system2(RUN_JOB, shQuote(dir), stdout = log, stderr = log)
  res_path <- file.path(dir, "result.json")
  prog <- file.path(dir, "progress.ndjson")
  list(
    status = status,
    dir = dir,
    result_path = res_path,
    json = if (file.exists(res_path)) read_json_list(res_path) else NULL,
    text = if (file.exists(res_path)) paste(readLines(res_path, warn = FALSE, encoding = "UTF-8"), collapse = "\n") else "",
    progress = if (file.exists(prog)) lapply(readLines(prog, warn = FALSE), jsonlite::fromJSON, simplifyVector = FALSE) else list(),
    log = if (file.exists(log)) paste(readLines(log, warn = FALSE), collapse = "\n") else ""
  )
}

node_available <- function() nzchar(Sys.which("node")) &&
  file.exists(file.path(REPO_DIR, "packages", "contracts", "node_modules", "ajv", "dist", "2020.js"))

#' JSON Schema validation through node + ajv (the repository's own validator setup).
expect_schema_valid <- function(paths) {
  if (!node_available()) testthat::skip("node or packages/contracts/node_modules/ajv not available")
  out <- suppressWarnings(system2("node", c(shQuote(VALIDATOR), shQuote(paths)), stdout = TRUE, stderr = TRUE))
  st <- attr(out, "status")
  testthat::expect(is.null(st) || st == 0L, paste(c("schema validation failed:", out), collapse = "\n"))
}

#' Cross-field rules of contracts.md §6 (the Zod refinements), checked in R.
expect_cross_field_valid <- function(r) {
  fields <- c("est", "se", "statistic", "pValue", "ciLower", "ciUpper")
  testthat::expect_equal(r$sample$nUsed + r$sample$nDropped, r$sample$nRows)
  for (p in r$parameters) {
    for (f in fields) {
      is_null <- is.null(p[[f]])
      has_reason <- !is.null(p$missing[[f]])
      testthat::expect(is_null == has_reason, sprintf("%s: %s null=%s reason=%s", p$key, f, is_null, has_reason))
    }
    if (!is.null(p$pValue)) testthat::expect(p$pValue >= 0 && p$pValue <= 1, paste(p$key, "p outside [0,1]"))
    if (!is.null(p$ciLower) && !is.null(p$ciUpper)) testthat::expect(p$ciLower <= p$ciUpper, paste(p$key, "ciLower > ciUpper"))
  }
  for (m in c(r$constructMetrics, r$fit)) {
    testthat::expect(is.null(m$value) == !is.null(m$missing), paste("metric", m$metric, m$name, "null/missing mismatch"))
  }
  for (m in r$matrices) {
    testthat::expect_equal(length(m$values), length(m$rowIds))
    for (row in m$values) testthat::expect_equal(length(row), length(m$colIds))
  }
  if (!is.null(r$bootstrap)) {
    b <- r$bootstrap
    testthat::expect_equal(b$completed + b$failed + b$inadmissible, b$requested)
    for (d in b$draws) testthat::expect_true(all(vapply(d, is.numeric, logical(1))))
  }
  keys <- vapply(r$parameters, function(p) p$key, "")
  testthat::expect_false(anyDuplicated(keys) > 0)
}

#' Run, assert success, validate, return the NormalizedSemResult list.
run_ok <- function(dir) {
  out <- run_engine(dir)
  testthat::expect_equal(out$status, 0L)
  if (!isTRUE(out$json$ok)) stop("engine returned an error: ", out$json$error$code, " ", out$json$error$message)
  expect_schema_valid(out$result_path)
  expect_cross_field_valid(out$json$result)
  r <- out$json$result
  attr(r, "run") <- out
  r
}

#' Run, assert a handled error with `code`, validate the envelope, return the error.
run_err <- function(dir, code) {
  out <- run_engine(dir)
  testthat::expect_equal(out$status, 0L)
  testthat::expect_false(isTRUE(out$json$ok))
  testthat::expect_equal(out$json$error$code, code)
  expect_schema_valid(out$result_path)
  e <- out$json$error
  attr(e, "run") <- out
  e
}

param <- function(r, key) {
  for (p in r$parameters) if (identical(p$key, key)) return(p)
  stop("no parameter ", key)
}
est <- function(r, key) param(r, key)$est
metric <- function(r, cid, name) {
  for (m in r$constructMetrics) if (identical(m$constructId, cid) && identical(m$metric, name)) return(m)
  stop("no metric ", cid, " ", name)
}
mat <- function(r, id) {
  for (m in r$matrices) if (identical(m$id, id)) return(m)
  stop("no matrix ", id)
}
num <- function(x) if (is.null(x)) NA_real_ else as.numeric(x)

#' Modify one indicator of a SemModel.
set_indicator <- function(model, id, ...) {
  ch <- list(...)
  model$indicators <- lapply(model$indicators, function(i) if (identical(i$id, id)) utils::modifyList(i, ch) else i)
  model
}

#' Path of a temporary copy of the capability registry with r-csem statuses changed,
#' e.g. registry_override(list("ipma.construct" = "beta")). Use with
#' withr::local_envvar(SEM_STUDIO_REGISTRY = path).
registry_override <- function(statuses) {
  reg <- read_json_list(file.path(REPO_DIR, "packages", "method-registry", "registry.json"))
  for (i in seq_along(reg$capabilities)) {
    id <- reg$capabilities[[i]]$id
    if (id %in% names(statuses)) {
      reg$capabilities[[i]]$engines$`r-csem`$status <- statuses[[id]]
      if (!statuses[[id]] %in% c("supported", "beta")) reg$capabilities[[i]]$engines$`r-csem`$reason <- "test override"
    }
  }
  f <- tempfile(fileext = ".json")
  writeLines(jsonlite::toJSON(reg, auto_unbox = TRUE, null = "null", digits = NA), f)
  f
}

registry_status <- function(cap_id) {
  reg <- read_json_list(file.path(REPO_DIR, "packages", "method-registry", "registry.json"))
  for (c in reg$capabilities) if (identical(c$id, cap_id)) return(c$engines$`r-csem`$status)
  NA_character_
}
