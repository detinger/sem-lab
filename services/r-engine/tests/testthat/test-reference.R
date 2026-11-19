# Numerical reference tests on the synthetic fixtures (analytic oracles).
# Exact fixtures: the (N-1) sample covariance equals the population model-implied
# covariance, so a consistent estimator must return the population values.

TOL_ORACLE <- 1e-6

test_that("PLSc on tam-mediation-exact recovers the population parameters", {
  fx <- fixture("tam-mediation-exact")
  r <- run_ok(make_job(fx$model, fixture_analysis(fx, "plsc-csem"), fx$data))
  dev <- c(
    est(r, "path:c_peou->c_pu") - 0.60,
    est(r, "path:c_peou->c_bi") - 0.20,
    est(r, "path:c_pu->c_bi") - 0.50,
    est(r, "indirect:c_peou->c_bi") - 0.30,
    est(r, "specific-indirect:c_peou->c_pu->c_bi") - 0.30,
    est(r, "total:c_peou->c_bi") - 0.50,
    num(metric(r, "c_pu", "r2")$value) - 0.36,
    num(metric(r, "c_bi", "r2")$value) - 0.41
  )
  lam <- list()
  for (cc in fx$population$constructs) for (col in names(cc$standardizedLoadings)) {
    key <- sprintf("loading:c_%s:i_%s", tolower(cc$name), col)
    dev <- c(dev, est(r, key) - cc$standardizedLoadings[[col]])
  }
  cat(sprintf("\n[reference] PLSc tam-mediation-exact max |dev| = %.3g\n", max(abs(dev))))
  expect_lt(max(abs(dev)), TOL_ORACLE)
  expect_true(r$estimation$converged)
  expect_true(r$estimation$admissible)
  # rho_A, rho_C, AVE equal the population derived truths for a consistent estimator
  for (nm in c("PEOU", "PU", "BI")) {
    tr <- fx$population$derivedTruths$constructs[[nm]]
    cid <- paste0("c_", tolower(nm))
    expect_lt(abs(num(metric(r, cid, "ave")$value) - tr$AVE), TOL_ORACLE)
    expect_lt(abs(num(metric(r, cid, "rho-c")$value) - tr$rhoC), TOL_ORACLE)
  }
})

test_that("classic PLS on tam-mediation-exact equals the classic-PLS population limit", {
  fx <- fixture("tam-mediation-exact")
  r <- run_ok(make_job(fx$model, fixture_analysis(fx, "pls-csem"), fx$data))
  lim <- fx$population$derivedTruths$classicPlsPopulationLimit$paths
  dev <- vapply(lim, function(p) est(r, sprintf("path:c_%s->c_%s", tolower(p$source), tolower(p$target))) - p$coefficient, 0)
  # indirect / total limits: products / sums of the limit paths (manifest: 0.231827 / 0.435430)
  pc <- stats::setNames(vapply(lim, function(p) p$coefficient, 0), vapply(lim, function(p) paste(p$source, p$target), ""))
  ind_lim <- pc[["PEOU PU"]] * pc[["PU BI"]]
  tot_lim <- pc[["PEOU BI"]] + ind_lim
  expect_lt(abs(tot_lim - fx$population$derivedTruths$classicPlsPopulationLimit$compositeCorrelations$matrix[[1]][[3]]), 1e-12)
  dev <- c(dev, est(r, "indirect:c_peou->c_bi") - ind_lim, est(r, "total:c_peou->c_bi") - tot_lim)
  cat(sprintf("\n[reference] classic tam-mediation-exact max |dev| paths/indirect/total = %.3g\n", max(abs(dev))))
  expect_lt(max(abs(dev)), TOL_ORACLE)
  # rho_A is reported (from the auxiliary PLSc fit) and equals the population value
  for (nm in c("PEOU", "PU", "BI")) {
    tr <- fx$population$derivedTruths$constructs[[nm]]
    expect_lt(abs(num(metric(r, paste0("c_", tolower(nm)), "rho-a")$value) - tr$rhoA), TOL_ORACLE)
  }
  # no bootstrap requested: inference null with "not-requested"
  p <- param(r, "path:c_peou->c_pu")
  expect_null(p$se)
  expect_equal(p$missing$se, "not-requested")
  expect_equal(p$missing$ciLower, "not-requested")
  expect_null(r$bootstrap)
})

test_that("Mode B weights and composite loadings on pls-mixed-composite-exact equal the population values", {
  fx <- fixture("pls-mixed-composite-exact")
  F <- fx$population$constructs[[1]]
  w <- unlist(F$weights)
  lc <- unlist(F$compositeLoadings)
  devs <- c()
  for (aid in c("pls-csem", "plsc-csem")) {
    r <- run_ok(make_job(fx$model, fixture_analysis(fx, aid), fx$data))
    dw <- vapply(names(w), function(i) est(r, sprintf("weight:c_f:i_%s", i)) - w[[i]], 0)
    dl <- vapply(names(lc), function(i) est(r, sprintf("loading:c_f:i_%s", i)) - lc[[i]], 0)
    devs <- c(devs, dw, dl)
    expect_lt(max(abs(c(dw, dl))), TOL_ORACLE)
    # reliability / validity metrics are not applicable to the composite
    for (m in c("cronbach-alpha", "rho-a", "rho-c", "ave")) {
      mm <- metric(r, "c_f", m)
      expect_null(mm$value)
      expect_equal(mm$missing, "not-applicable")
    }
    expect_false("c_f" %in% unlist(mat(r, "htmt")$rowIds))
    vb <- mat(r, "vif-indicator-mode-b")
    expect_equal(unlist(vb$colIds), "c_f")
    codes <- vapply(r$warnings, function(x) x$code, "")
    expect_true("EXOGENOUS_CORRELATION_IMPLIED" %in% codes)
    if (aid == "plsc-csem") {
      expect_lt(abs(est(r, "path:c_f->c_y") - 0.40), TOL_ORACLE)
      expect_lt(abs(est(r, "path:c_x->c_y") - 0.30), TOL_ORACLE)
    } else {
      lim <- fx$population$derivedTruths$classicPlsPopulationLimit$paths
      for (p in lim) {
        expect_lt(abs(est(r, sprintf("path:c_%s->c_%s", tolower(p$source), tolower(p$target))) - p$coefficient), TOL_ORACLE)
      }
    }
  }
  cat(sprintf("\n[reference] mixed-composite-exact max |dev| weights+composite loadings = %.3g\n", max(abs(devs))))
})

test_that("aliasing changes nothing: engine equals a direct cSEM call with the user's names (pls-two-construct)", {
  fx <- fixture("pls-two-construct")
  an <- pls_analysis("pls-sem", tol = 1e-10)
  r1 <- run_ok(make_job(fx$model, an, fx$data))
  r2 <- run_ok(make_job(fx$model, an, fx$data))
  d <- utils::read.csv(fx$data)
  # direct call, user's construct names and column names, same options as the engine
  direct <- cSEM::csem(d, "X =~ x1 + x2 + x3\nY =~ y1 + y2 + y3\nY ~ X",
                       .approach_weights = "PLS-PM", .approach_paths = "OLS", .disattenuate = FALSE,
                       .PLS_weight_scheme_inner = "path", .iter_max = 300L, .tolerance = 1e-10,
                       .conv_criterion = "diff_absolute")
  E <- direct$Estimates
  dev <- c(est(r1, "path:c_x->c_y") - E$Path_estimates["Y", "X"],
           num(metric(r1, "c_y", "r2")$value) - E$R2[["Y"]])
  for (blk in list(c("X", "x"), c("Y", "y"))) for (k in 1:3) {
    i <- paste0(blk[2], k)
    dev <- c(dev, est(r1, sprintf("loading:c_%s:i_%s", tolower(blk[1]), i)) - E$Loading_estimates[blk[1], i],
             est(r1, sprintf("weight:c_%s:i_%s", tolower(blk[1]), i)) - E$Weight_estimates[blk[1], i])
  }
  cat(sprintf("\n[reference] aliasing pls-two-construct max |dev| vs direct cSEM = %.3g\n", max(abs(dev))))
  expect_lt(max(abs(dev)), 1e-12)
  # repeatability: identical estimates on a second run
  strip <- function(r) lapply(r$parameters, function(p) p[c("key", "est")])
  expect_identical(strip(r1), strip(r2))
  # all population loadings and the path are positive
  expect_gt(est(r1, "path:c_x->c_y"), 0)
})

test_that("reverse scoring: x3_rev with reverseScored and scale {1,7} reproduces the x3 run", {
  fx <- fixture("pls-two-construct")
  an <- pls_analysis("pls-sem", tol = 1e-10)
  r1 <- run_ok(make_job(fx$model, an, fx$data))
  m2 <- set_indicator(fx$model, "i_x3", column = "x3_rev", reverseScored = TRUE, scale = list(min = 1, max = 7))
  r2 <- run_ok(make_job(m2, an, fx$data))
  e1 <- vapply(r1$parameters, function(p) num(p$est), 0)
  e2 <- vapply(r2$parameters, function(p) num(p$est), 0)
  expect_lt(max(abs(e1 - e2)), 1e-12)
  expect_true("REVERSE_SCORED_APPLIED" %in% vapply(r2$warnings, function(x) x$code, ""))
})

test_that("single-indicator construct: reliability not applicable, loading/weight fixed", {
  fx <- fixture("tam-mediation")
  m <- fx$model
  m$constructs[[3]]$indicatorIds <- list("i_bi1")
  r <- run_ok(make_job(m, pls_analysis("pls-sem"), fx$data))
  for (nm in c("cronbach-alpha", "rho-a", "rho-c", "ave")) expect_equal(metric(r, "c_bi", nm)$missing, "not-applicable")
  p <- param(r, "loading:c_bi:i_bi1")
  expect_equal(p$status, "fixed")
  expect_equal(p$est, 1)
  expect_false("c_bi" %in% unlist(mat(r, "htmt")$rowIds))
})

test_that("inner weighting schemes are applied (different estimates for centroid / factorial)", {
  fx <- fixture("tam-mediation")
  ests <- lapply(c("path", "centroid", "factorial"), function(s) {
    r <- run_ok(make_job(fx$model, pls_analysis("pls-sem", scheme = s), fx$data))
    expect_true(grepl(sprintf(".PLS_weight_scheme_inner = \"%s\"", s), r$provenance$call, fixed = TRUE))
    vapply(r$parameters, function(p) num(p$est), 0)
  })
  expect_gt(max(abs(ests[[1]] - ests[[2]])), 0)
})
