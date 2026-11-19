# IPMA (importance-performance map analysis), construct and indicator level.
# The capability registry may still mark ipma.* as "planned" for r-csem; these tests run
# against a registry copy with ipma.construct / ipma.indicator = "beta" so the computation
# is tested independently of the release gate (the gate itself is tested at the end).

ipma_env <- function() c(SEM_LAB_REGISTRY = registry_override(list("ipma.construct" = "beta", "ipma.indicator" = "beta")))

ipma_run <- function(model, analysis, data) {
  withr::with_envvar(ipma_env(), run_ok(make_job(model, analysis, data)))
}
ipma_err <- function(model, analysis, data, code) {
  withr::with_envvar(ipma_env(), run_err(make_job(model, analysis, data), code))
}
ipma_analysis <- function(target = "c_bi", ...) {
  a <- pls_analysis("pls-sem", tol = 1e-10, ...)
  a$ipma <- list(targetConstructId = target)
  a
}
ip_con <- function(r, cid) { for (x in r$ipma$constructs) if (x$constructId == cid) return(x); stop("no ", cid) }
ip_ind <- function(r, iid) { for (x in r$ipma$indicators) if (x$indicatorId == iid) return(x); stop("no ", iid) }

#' Reference: cSEM::doIPMA on a classic fit of the 0-100 rescaled data, user names.
doipma_reference <- function(d100, model_syntax) {
  fit <- cSEM::csem(d100, model_syntax, .approach_weights = "PLS-PM", .approach_paths = "OLS", .disattenuate = FALSE,
                    .PLS_weight_scheme_inner = "path", .iter_max = 300L, .tolerance = 1e-10, .conv_criterion = "diff_absolute")
  suppressWarnings(cSEM::doIPMA(fit))
}

test_that("indicator performance uses the ORIGINAL endpoints, not observed extrema (ipma-range-restricted)", {
  fx <- fixture("ipma-range-restricted")
  r <- ipma_run(fx$model, fixture_analysis(fx, "ipma-csem"), fx$data)
  man <- read_json_list(file.path(fx$dir, "manifest.json"))$ipmaIndicatorPerformance
  dev <- c()
  for (col in names(man)) {
    ii <- paste0("i_", col)
    if (col %in% c("bi1", "bi2", "bi3")) next          # target block: not a predecessor
    p <- ip_ind(r, ii)$performance
    dev <- c(dev, p - (man[[col]]$mean - 1) / 6 * 100, p - man[[col]]$performanceOriginalEndpoints)
  }
  cat(sprintf("\n[ipma] range-restricted indicator performance max |dev| vs (mean-1)/6*100 = %.3g\n", max(abs(dev))))
  expect_lt(max(abs(dev)), 1e-10)
  # PEOU items: observed 3..7 would give ~48.9, the right answer is ~65.9
  expect_gt(ip_ind(r, "i_peou1")$performance, 60)
  for (x in r$ipma$constructs) {
    expect_true(x$performance >= 0 && x$performance <= 100)
  }
  expect_equal(r$ipma$targetConstructId, "c_bi")
  expect_setequal(vapply(r$ipma$constructs, function(x) x$constructId, ""), c("c_peou", "c_pu"))
  expect_equal(ip_con(r, "c_peou")$predecessor, "direct")
  expect_true(nchar(r$ipma$convention) > 100)
})

test_that("engine IPMA equals cSEM::doIPMA on the rescaled classic fit; first-principles identities hold", {
  fx <- fixture("ipma-range-restricted")
  r <- ipma_run(fx$model, ipma_analysis(), fx$data)
  d <- utils::read.csv(fx$data)
  d100 <- (d - 1) / 6 * 100
  ip <- doipma_reference(d100, "PEOU =~ peou1 + peou2 + peou3 + peou4\nPU =~ pu1 + pu2 + pu3 + pu4\nBI =~ bi1 + bi2 + bi3\nPU ~ PEOU\nBI ~ PEOU + PU")
  dev <- c()
  for (k in c("PEOU", "PU")) {
    x <- ip_con(r, paste0("c_", tolower(k)))
    dev <- c(dev, x$importance - ip$Construct$Importance["BI", k], x$performance - ip$Construct$Performance[[k]])
  }
  for (col in c(paste0("peou", 1:4), paste0("pu", 1:4))) {
    x <- ip_ind(r, paste0("i_", col))
    dev <- c(dev, x$importance - ip$Indicator$Importance["BI", col], x$performance - ip$Indicator$Performance[[col]])
  }
  cat(sprintf("\n[ipma] engine vs cSEM::doIPMA max |dev| = %.3g\n", max(abs(dev))))
  expect_lt(max(abs(dev)), 1e-10)
  # indicator importance sums to the construct importance within each block (weights sum to 1)
  for (cid in c("c_peou", "c_pu")) {
    s <- sum(vapply(Filter(function(x) x$constructId == cid, r$ipma$indicators), function(x) x$importance, 0))
    expect_lt(abs(s - ip_con(r, cid)$importance), 1e-12)
  }
  # importance = standardized total effect x sd(target score) / sd(predecessor score): sign agrees
  expect_equal(sign(ip_con(r, "c_peou")$importance), sign(est(r, "total:c_peou->c_bi")))
})

test_that("adding IPMA leaves every main estimate unchanged; schema still valid", {
  fx <- fixture("ipma-range-restricted")
  a0 <- pls_analysis("pls-sem", tol = 1e-10)
  r0 <- ipma_run(fx$model, a0, fx$data)
  r1 <- ipma_run(fx$model, ipma_analysis(), fx$data)
  expect_null(r0$ipma)
  strip <- function(r) lapply(r$parameters, function(p) p[c("key", "est")])
  expect_identical(strip(r0), strip(r1))
  expect_identical(r0$constructMetrics, r1$constructMetrics)
  expect_identical(r0$matrices, r1$matrices)
})

test_that("reverse scoring happens before rescaling; bootstrap adds IPMA_NO_INTERVALS", {
  fx <- fixture("tam-mediation")
  m <- set_indicator(fx$model, "i_pu1", reverseScored = TRUE)
  r <- ipma_run(m, ipma_analysis(bootstrap = list(repetitions = 30L)), fx$data)
  d <- utils::read.csv(fx$data)
  expect_lt(abs(ip_ind(r, "i_pu1")$performance - (mean(8 - d$pu1) - 1) / 6 * 100), 1e-10)
  expect_lt(abs(ip_ind(r, "i_pu2")$performance - (mean(d$pu2) - 1) / 6 * 100), 1e-10)
  expect_true("IPMA_NO_INTERVALS" %in% vapply(r$warnings, function(w) w$code, ""))
})

test_that("indirect-only predecessors are listed as 'indirect' (target PU <- PEOU, BI <- PU chain)", {
  fx <- fixture("tam-mediation")
  m <- fx$model
  m$relationships <- Filter(function(x) x$id != "r_peou_bi", m$relationships)   # PEOU -> PU -> BI only
  r <- ipma_run(m, ipma_analysis(), fx$data)
  expect_equal(ip_con(r, "c_peou")$predecessor, "indirect")
  expect_equal(ip_con(r, "c_pu")$predecessor, "direct")
})

test_that("tam-v1 target BI reproduces the Phase 0 values (settings-file endpoints)", {
  skip_if_not(file.exists(TAM_TXT), "TEMP/Example - TAM/Data.txt not present (git-ignored)")
  r <- ipma_run(tam_model(tam_settings_scales()), ipma_analysis(), tam_csv())
  want <- list(c_pu = c(0.626, 91.9), c_peou = c(0.263, 80.9), c_atu = c(0.205, 86.1))
  for (cid in names(want)) {
    x <- ip_con(r, cid)
    cat(sprintf("\n[ipma] tam-v1 BI <- %s: importance %.6f, performance %.4f", cid, x$importance, x$performance))
    expect_equal(round(x$importance, 3), want[[cid]][1])
    expect_equal(round(x$performance, 1), want[[cid]][2])
  }
  cat("\n")
  expect_setequal(vapply(r$ipma$constructs, function(x) x$constructId, ""), c("c_pu", "c_peou", "c_atu"))
})

test_that("IPMA request errors", {
  fx <- fixture("ipma-range-restricted")
  # missing scale on one indicator
  m <- set_indicator(fx$model, "i_pu3", scale = NULL)
  e <- ipma_err(m, ipma_analysis(), fx$data, "REQUEST_INVALID")
  expect_equal(e$details$reason, "ipma-scale-missing")
  expect_equal(unlist(e$details$indicatorIds), "i_pu3")
  # observed value outside the declared endpoints
  m2 <- set_indicator(fx$model, "i_pu3", scale = list(min = 2, max = 7))
  e2 <- ipma_err(m2, ipma_analysis(), fx$data, "REQUEST_INVALID")
  expect_equal(e2$details$reason, "ipma-out-of-scale")
  expect_equal(unlist(e2$details$indicatorIds), "i_pu3")
  # PLSc
  a3 <- ipma_analysis(); a3$method <- "plsc"
  e3 <- ipma_err(fx$model, a3, fx$data, "CAPABILITY_UNSUPPORTED")
  expect_true(grepl("classic PLS", e3$message, fixed = TRUE))
  # unknown target
  e4 <- ipma_err(fx$model, ipma_analysis("c_nope"), fx$data, "REQUEST_INVALID")
  expect_equal(e4$details$reason, "ipma-target-unknown")
  # exogenous target: no predecessors
  e5 <- ipma_err(fx$model, ipma_analysis("c_peou"), fx$data, "REQUEST_INVALID")
  expect_equal(e5$details$reason, "ipma-no-predecessors")
})

test_that("the shipped registry gate is honoured", {
  st <- registry_status("ipma.construct")
  fx <- fixture("ipma-range-restricted")
  out <- run_engine(make_job(fx$model, ipma_analysis(), fx$data))
  if (st %in% c("supported", "beta")) {
    expect_true(isTRUE(out$json$ok))
  } else {
    expect_equal(out$json$error$code, "CAPABILITY_UNSUPPORTED")
    expect_equal(out$json$error$details$capabilityId, "ipma.construct")
  }
})
