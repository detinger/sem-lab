# Chunked bootstrap: reproducibility, bookkeeping, interval definitions, failure and
# inadmissibility counting, cancellation, timing.

boot_job <- function(fx_case = "tam-mediation", method = "pls-sem", reps = 200L, seed = 20261119L,
                     chunk = NULL, sides = "two-sided", level = 0.95, data = NULL, model = NULL) {
  fx <- fixture(fx_case)
  limits <- list(maxBootstrap = 10000L, timeoutSeconds = 1800L)
  if (!is.null(chunk)) limits$chunkSize <- chunk
  make_job(if (is.null(model)) fx$model else model,
           pls_analysis(method, tol = 1e-7, bootstrap = list(repetitions = reps, sides = sides, confidenceLevel = level), seed = seed),
           if (is.null(data)) fx$data else data, limits = limits)
}

test_that("same seed gives identical draws and intervals; a different seed differs", {
  r1 <- run_ok(boot_job(seed = 11L))
  r2 <- run_ok(boot_job(seed = 11L))
  r3 <- run_ok(boot_job(seed = 12L))
  expect_identical(r1$bootstrap$draws, r2$bootstrap$draws)
  ci <- function(r) lapply(r$parameters, function(p) p[c("key", "se", "ciLower", "ciUpper", "pValue")])
  expect_identical(ci(r1), ci(r2))
  expect_false(identical(r1$bootstrap$draws, r3$bootstrap$draws))
  expect_equal(r1$bootstrap$chunkSize, 100L)
  expect_equal(r1$bootstrap$seed, 11L)
})

test_that("bookkeeping and interval definitions match the stored draws", {
  r <- run_ok(boot_job(reps = 250L))
  b <- r$bootstrap
  expect_equal(b$requested, 250L)
  expect_equal(b$completed + b$failed + b$inadmissible, b$requested)
  expect_setequal(names(b$draws), c("path:c_peou->c_pu", "path:c_peou->c_bi", "path:c_pu->c_bi",
                                    "specific-indirect:c_peou->c_pu->c_bi"))
  for (k in names(b$draws)) {
    d <- unlist(b$draws[[k]])
    p <- param(r, k)
    expect_equal(length(d), b$completed)
    expect_equal(p$inference$nValid, b$completed)
    # stored draws are rounded to 6 significant digits; intervals use full precision
    q <- stats::quantile(d, c(0.025, 0.975), type = 7, names = FALSE)
    expect_lt(abs(p$ciLower - q[1]), 1e-5)
    expect_lt(abs(p$ciUpper - q[2]), 1e-5)
    expect_lt(abs(p$se - stats::sd(d)), 1e-5)
    expect_equal(p$statistic, p$est / p$se, tolerance = 1e-12)
    expect_equal(p$pValue, 2 * stats::pt(-abs(p$statistic), p$inference$nValid - 1), tolerance = 1e-10)
    expect_equal(p$statisticType, "t")
  }
  # specific indirect draws are the per-draw products of the path draws
  prod_d <- unlist(b$draws[["path:c_peou->c_pu"]]) * unlist(b$draws[["path:c_pu->c_bi"]])
  expect_lt(max(abs(prod_d - unlist(b$draws[["specific-indirect:c_peou->c_pu->c_bi"]]))), 1e-5)
  # progress reports every chunk with real counts
  bl <- Filter(function(e) identical(e$stage, "bootstrapping"), attr(r, "run")$progress)
  expect_equal(vapply(bl, function(e) e$done, 0), c(0, 100, 200, 250))
  expect_true(all(vapply(bl, function(e) e$total == 250, TRUE)))
})

test_that("chunk k uses .seed = seed + k: first chunk equals a direct resamplecSEMResults call", {
  fx <- fixture("tam-mediation")
  r <- run_ok(boot_job(reps = 150L, seed = 777L))
  d <- utils::read.csv(fx$data)
  fit <- cSEM::csem(d, "PEOU =~ peou1 + peou2 + peou3 + peou4\nPU =~ pu1 + pu2 + pu3 + pu4\nBI =~ bi1 + bi2 + bi3\nPU ~ PEOU\nBI ~ PEOU + PU",
                    .disattenuate = FALSE, .tolerance = 1e-7, .iter_max = 300L)
  ref <- lapply(0:1, function(k) cSEM::resamplecSEMResults(fit, .resample_method = "bootstrap", .R = c(100L, 50L)[k + 1L],
                                                           .seed = 777L + k, .handle_inadmissibles = "drop",
                                                           .sign_change_option = "none"))
  refd <- unlist(lapply(ref, function(x) x$Estimates$Estimates_resample$Estimates1$Path_estimates$Resampled[, "PU ~ PEOU"]))
  expect_lt(max(abs(unlist(r$bootstrap$draws[["path:c_peou->c_pu"]]) - signif(refd, 6))), 1e-12)
})

test_that("one-sided intervals report one bound; the other is null with not-applicable", {
  r <- run_ok(boot_job(reps = 120L, sides = "one-sided", level = 0.95))
  p <- param(r, "path:c_peou->c_pu")
  expect_gt(p$est, 0)
  expect_null(p$ciUpper)
  expect_equal(p$missing$ciUpper, "not-applicable")
  d <- unlist(r$bootstrap$draws[["path:c_peou->c_pu"]])
  expect_lt(abs(p$ciLower - stats::quantile(d, 0.05, type = 7, names = FALSE)), 1e-5)
  expect_equal(p$pValue, stats::pt(-abs(p$statistic), p$inference$nValid - 1), tolerance = 1e-10)
  expect_equal(p$inference$sides, "one-sided")
})

test_that("PLSc on a small sample produces counted inadmissible draws", {
  fx <- fixture("tam-mediation")
  d <- utils::read.csv(fx$data)[1:30, ]
  r <- run_ok(boot_job(method = "plsc", reps = 200L, data = d))
  b <- r$bootstrap
  cat(sprintf("\n[bootstrap] PLSc n=30, B=200: completed %d, inadmissible %d, failed %d\n", b$completed, b$inadmissible, b$failed))
  expect_gt(b$inadmissible, 0L)
  expect_equal(b$completed + b$failed + b$inadmissible, 200L)
  expect_equal(param(r, "path:c_peou->c_pu")$inference$nValid, b$completed)
  expect_true("BOOTSTRAP_INADMISSIBLE_DROPPED" %in% vapply(r$warnings, function(w) w$code, ""))
  bl <- Filter(function(e) identical(e$stage, "bootstrapping"), attr(r, "run")$progress)
  expect_equal(bl[[length(bl)]]$inadmissible, b$inadmissible)
})

test_that("an erroring chunk is re-run draw by draw and failures are counted per draw", {
  fx <- fixture("tam-mediation")
  d <- utils::read.csv(fx$data)
  # an almost-constant indicator: some resamples contain no 1 -> zero variance -> cSEM error
  d$bi3 <- 0
  d$bi3[c(5, 250, 400)] <- 1
  r <- run_ok(boot_job(reps = 103L, chunk = 50L, data = d))
  b <- r$bootstrap
  cat(sprintf("\n[bootstrap] near-constant indicator, B=103: completed %d, failed %d, inadmissible %d\n", b$completed, b$failed, b$inadmissible))
  expect_gt(b$failed, 0L)
  expect_equal(b$completed + b$failed + b$inadmissible, 103L)
  expect_true("BOOTSTRAP_FAILED_DRAWS" %in% vapply(r$warnings, function(w) w$code, ""))
  # deterministic: the per-draw fallback uses fixed seeds
  r2 <- run_ok(boot_job(reps = 103L, chunk = 50L, data = d))
  expect_identical(r$bootstrap$draws, r2$bootstrap$draws)
})

test_that("a chunk with fewer than 3 draws (resamplecSEMResults minimum) is handled", {
  r <- run_ok(boot_job(reps = 101L))
  expect_equal(r$bootstrap$completed + r$bootstrap$failed + r$bootstrap$inadmissible, 101L)
  expect_equal(length(r$bootstrap$draws[[1]]), r$bootstrap$completed)
})

test_that("a cancel file stops the job between chunks with CANCELLED and no result", {
  skip_if_not_installed("processx")
  dir <- boot_job(reps = 5000L, chunk = 20L)
  pr <- processx::process$new(RUN_JOB, dir, stdout = file.path(dir, "engine.log"), stderr = "2>&1")
  prog <- file.path(dir, "progress.ndjson")
  t0 <- Sys.time()
  repeat {
    if (file.exists(prog) && any(grepl("\"done\":20", readLines(prog, warn = FALSE)))) break
    if (!pr$is_alive() || difftime(Sys.time(), t0, units = "secs") > 120) break
    Sys.sleep(0.05)
  }
  file.create(file.path(dir, "cancel"))
  pr$wait(60000)
  expect_equal(pr$get_exit_status(), 0L)
  res <- read_json_list(file.path(dir, "result.json"))
  expect_false(isTRUE(res$ok))
  expect_equal(res$error$code, "CANCELLED")
  expect_null(res$result)
  bl <- Filter(function(e) identical(e$stage, "bootstrapping"),
               lapply(readLines(prog, warn = FALSE), jsonlite::fromJSON, simplifyVector = FALSE))
  expect_lt(bl[[length(bl)]]$done, 5000)
  expect_false(any(vapply(lapply(readLines(prog, warn = FALSE), jsonlite::fromJSON), function(e) identical(e$stage, "summarizing"), TRUE)))
})

test_that("timing: seconds per 100 bootstrap draws (tam-mediation, n = 500)", {
  for (method in c("pls-sem", "plsc")) {
    r <- run_ok(boot_job(method = method, reps = 500L))
    bl <- Filter(function(e) identical(e$stage, "bootstrapping"), attr(r, "run")$progress)
    ts <- as.POSIXct(vapply(bl, function(e) e$t, ""), format = "%Y-%m-%dT%H:%M:%OSZ", tz = "UTC")
    secs <- as.numeric(difftime(ts[length(ts)], ts[1], units = "secs"))
    cat(sprintf("\n[timing] %s tam-mediation n=500: %.2f s per 100 draws (%d draws in %.2f s, sequential)\n",
                method, secs / 5, 500L, secs))
    expect_gt(secs, 0)
  }
})

test_that("mixed Mode A / Mode B model with PLSc bootstraps weights, loadings and effects", {
  fx <- fixture("pls-mixed-composite")
  r <- run_ok(make_job(fx$model, pls_analysis("plsc", tol = 1e-7, bootstrap = list(repetitions = 120L)), fx$data))
  w <- param(r, "weight:c_f:i_f1")
  expect_equal(w$inference$method, "bootstrap-percentile")
  expect_true(is.numeric(w$se) && w$se > 0)
  expect_equal(param(r, "total:c_f->c_y")$est, param(r, "path:c_f->c_y")$est)
  vb <- mat(r, "vif-indicator-mode-b")
  expect_true(all(vapply(vb$values, function(row) is.numeric(row[[1]]), TRUE)))
})
