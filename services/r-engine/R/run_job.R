# Job orchestration: request.json + data.csv in; progress.ndjson + result.json out.
# See docs/architecture/engine-protocol.md and docs/estimators/pls-csem.md.

DRAW_SIGNIF <- 6L   # stored draws (bootstrap.draws) are rounded to 6 significant digits

package_versions <- function() {
  pk <- c("cSEM", "jsonlite", "future", "future.apply", "matrixStats")
  v <- vapply(pk, function(p) tryCatch(as.character(utils::packageVersion(p)), error = function(e) "absent"), character(1))
  c(list(R = paste(R.version$major, R.version$minor, sep = ".")), as.list(v))
}

#' Run one job directory. Always returns the exit status to use (0 = result.json
#' written, either ok:true or a handled ok:false error).
run_job <- function(job_dir) {
  started <- Sys.time()
  progress <- make_progress(job_dir)
  result_path <- file.path(job_dir, "result.json")
  write_error <- function(code, message, details) {
    err <- list(code = code, message = message)
    if (length(details)) err$details <- details
    write_json_atomic(list(ok = FALSE, error = err), result_path)
  }
  out <- tryCatch({
    res <- run_job_inner(job_dir, progress, started)
    assert_no_nonfinite(res)
    write_json_atomic(list(ok = TRUE, result = res), result_path)
    log_line("job finished: ok")
    0L
  }, engine_error = function(e) {
    log_line("job finished with handled error ", e$code)
    write_error(e$code, conditionMessage(e), e$details)
    0L
  }, error = function(e) {
    log_line("internal error: ", sanitize_message(conditionMessage(e)))
    write_error("ENGINE_INTERNAL", "Unexpected internal error in the R engine. See the technical log.", list())
    0L
  })
  out
}

run_job_inner <- function(job_dir, progress, started) {
  progress("validating")
  req_path <- file.path(job_dir, "request.json")
  if (!file.exists(req_path)) invalid("request.json is missing from the job directory.")
  req <- tryCatch(jsonlite::fromJSON(req_path, simplifyVector = FALSE),
                  error = function(e) invalid("request.json is not valid JSON."))
  caps <- load_registry()
  spec <- validate_request(req, caps)
  deadline <- started + spec$limits$timeout
  dat <- load_job_data(file.path(job_dir, "data.csv"), spec)
  log_line("validated: method ", spec$method, ", ", length(spec$constructs), " constructs, ",
           length(spec$indicator_ids), " indicators, ", nrow(dat$X), " rows")

  if (cancel_requested(job_dir)) engine_error("CANCELLED", "The job was cancelled before estimation.")
  progress("estimating")
  suppressPackageStartupMessages(requireNamespace("cSEM", quietly = TRUE))
  al <- build_aliases(spec)
  model <- build_csem_model(spec, al)
  data <- alias_data(dat$X, al)
  est <- estimate_pls(spec, data, model, al)
  ts <- theta_spec(spec, al)
  theta <- extract_theta_fit(est$fit, ts)
  es <- effects_spec(spec)
  path_keys <- ts$key[ts$kind == "path"]
  eff_est <- compute_effects(matrix(theta[path_keys], 1L, dimnames = list(NULL, path_keys)), spec, es)

  bs <- NULL
  calls <- est$calls
  if (!is.null(spec$bootstrap)) {
    if (cancel_requested(job_dir)) engine_error("CANCELLED", "The job was cancelled before bootstrapping.")
    bs <- run_bootstrap(spec, est, data, model, ts, progress, job_dir, deadline)
    bs$effects <- compute_effects(bs$draws[, path_keys, drop = FALSE], spec, es)
    calls <- c(calls, sprintf(
      "for (k in 0:%d) cSEM::resamplecSEMResults(.object = fit, .resample_method = \"bootstrap\", .R = min(%d, %d - %d * k), .seed = (%s + k) %%%% 2147483647, .handle_inadmissibles = \"drop\", .sign_change_option = \"none\", .eval_plan = \"sequential\")",
      bs$n_chunks - 1L, spec$limits$chunk_size, spec$bootstrap$reps, spec$limits$chunk_size, format(spec$bootstrap$seed, scientific = FALSE)))
  }
  if (cancel_requested(job_dir)) engine_error("CANCELLED", "The job was cancelled before summarizing.")
  progress("summarizing")

  params <- build_parameters(spec, al, ts, theta, es, eff_est, bs)
  n <- nrow(dat$X)
  metrics <- build_construct_metrics(spec, al, est$fit, est$rho_fit, n)
  mats <- build_matrices(spec, al, est$fit, data)
  fit_idx <- build_fit(est$fit)
  warnings <- c(spec$warnings, collect_warnings(spec, al, est, theta, ts, bs, es, dat))

  admissible <- !any(est$verify)
  messages <- c(
    sprintf("PLS weights converged after %d iteration(s) (tolerance %s, .conv_criterion = \"diff_absolute\", .iter_max = %d).",
            as.integer(est$iterations), format(spec$tol), spec$max_iter),
    sprintf("Estimator: %s; inner weighting scheme \"%s\".",
            if (spec$method == "plsc") "consistent PLS (PLSc, .disattenuate = TRUE)" else "classic PLS-SEM (.disattenuate = FALSE)", spec$scheme),
    if (!admissible) paste0("cSEM::verify() failed: ", paste(VERIFY_CHECKS[names(est$verify)[est$verify]], collapse = "; "), "."),
    if (length(est$warnings)) paste0("cSEM warning: ", est$warnings)
  )
  messages <- substr(messages, 1L, 2000L)

  result <- list(
    schemaVersion = 1L,
    sample = list(nRows = as.integer(dat$n_rows), nUsed = as.integer(n), nDropped = as.integer(dat$n_rows - n),
                  missingData = "listwise"),
    estimation = list(converged = est$converged, iterations = est$iterations, admissible = admissible,
                      messages = I(as.character(messages))),
    parameters = params,
    constructMetrics = metrics,
    matrices = mats,
    fit = fit_idx
  )
  if (!is.null(bs)) {
    draw_keys <- c(path_keys, vapply(es$specific, `[[`, "", "key"))
    draws <- list()
    for (pk in path_keys) draws[[pk]] <- I(signif(bs$draws[, pk], DRAW_SIGNIF))
    for (j in seq_along(es$specific)) {
      key <- es$specific[[j]]$key
      if (nchar(key) <= 400L) draws[[key]] <- I(signif(bs$effects$specific[, j], DRAW_SIGNIF))
    }
    if (!length(draws)) draws <- stats::setNames(list(), character(0))
    result$bootstrap <- list(
      requested = as.integer(bs$requested), completed = as.integer(bs$completed), failed = as.integer(bs$failed),
      inadmissible = as.integer(bs$inadmissible), seed = spec$bootstrap$seed, ciMethod = "percentile",
      confidenceLevel = spec$bootstrap$level, chunkSize = as.integer(bs$chunk_size), draws = draws)
  }
  result$warnings <- warnings
  call_txt <- paste(calls, collapse = "\n")
  if (nchar(call_txt) > 4000L) call_txt <- paste0(substr(call_txt, 1L, 3980L), "\n[truncated]")
  result$provenance <- list(
    engine = ENGINE_ID, packageVersions = package_versions(),
    rVersion = paste(R.version$major, R.version$minor, sep = "."),
    call = call_txt, startedAt = iso_now(started), finishedAt = iso_now())
  result
}

collect_warnings <- function(spec, al, est, theta, ts, bs, es, dat) {
  w <- list()
  add <- function(code, severity, message, ids = NULL) {
    x <- list(code = code, severity = severity, message = substr(message, 1L, 2000L))
    if (length(ids)) x$elementIds <- I(unique(ids))
    w[[length(w) + 1L]] <<- x
  }
  if (length(dat$reversed)) {
    add("REVERSE_SCORED_APPLIED", "info",
        sprintf("%d indicator(s) were reverse scored before estimation as (scale min + scale max) - x.", length(dat$reversed)),
        dat$reversed)
  }
  if (any(est$verify)) {
    add("INADMISSIBLE_SOLUTION", "warning",
        paste0("The estimate is not admissible according to cSEM::verify(): ",
               paste(VERIFY_CHECKS[names(est$verify)[est$verify]], collapse = "; "),
               " failed. The numbers are reported but should not be interpreted without resolving this."))
  }
  neg <- ts[ts$kind == "loading" & !ts$single, ]
  neg <- neg[is.finite(theta[neg$key]) & theta[neg$key] < 0, ]
  if (nrow(neg)) {
    add("NEGATIVE_LOADING", "warning",
        sprintf("%d loading(s) are negative. A construct's sign is arbitrary in PLS (cSEM orients each block so that most loadings are positive); a negative loading usually means a reverse-worded item or a block whose indicators do not share one direction. Check item coding before interpreting path signs.", nrow(neg)),
        c(neg$source_id, neg$target_id))
  }
  if (!is.null(est$rho_msg)) add("RHO_A_UNAVAILABLE", "warning", est$rho_msg)
  if (es$truncated) {
    add("SPECIFIC_INDIRECT_TRUNCATED", "warning",
        sprintf("The structural model has more than %d indirect chains; only the first %d specific indirect effects are reported (total and total indirect effects are complete).",
                MAX_SPECIFIC_INDIRECT, MAX_SPECIFIC_INDIRECT))
  }
  if (!is.null(bs)) {
    if (bs$inadmissible > 0) {
      add("BOOTSTRAP_INADMISSIBLE_DROPPED", if (bs$inadmissible / bs$requested > 0.05) "warning" else "info",
          sprintf("%d of %d bootstrap samples were inadmissible (cSEM::verify()) and were excluded from the standard errors and intervals.",
                  bs$inadmissible, bs$requested))
    }
    if (bs$failed > 0) {
      add("BOOTSTRAP_FAILED_DRAWS", "warning",
          sprintf("%d of %d bootstrap samples could not be estimated (e.g. an indicator without variance in the resample) and were excluded.",
                  bs$failed, bs$requested))
    }
    if (bs$completed < 2) {
      add("BOOTSTRAP_TOO_FEW_DRAWS", "error",
          sprintf("Only %d valid bootstrap draw(s); standard errors, p values and intervals are not reported.", bs$completed))
    }
    if (spec$bootstrap$sides == "one-sided") {
      add("ONE_SIDED_DIRECTION", "info",
          "One-sided inference is taken in the direction of each point estimate's sign: for est >= 0 the lower bound (quantile 1 - level) and p = P(T <= -|t|); for est < 0 the upper bound (quantile level).")
    }
  }
  w
}
