# Handled errors: each problem gives its stable code, exit status 0, a valid error
# envelope, and no data values in the message, details or technical log.

tam <- function() fixture("tam-mediation")
tam_data <- function() utils::read.csv(tam()$data)

expect_no_values <- function(err, values) {
  run <- attr(err, "run")
  txt <- paste(run$text, run$log)
  for (v in values) expect_false(grepl(v, txt, fixed = TRUE), info = paste("leaked value", v))
}

test_that("missing column (broken-mapping fixture) -> DATA_COLUMN_MISSING naming the columns", {
  fx <- fixture("broken-mapping")
  e <- run_err(make_job(fx$model, fixture_analysis(fx, "pls-csem"), tam()$data), "DATA_COLUMN_MISSING")
  expect_true(length(e$details$columns) >= 1)
  for (cl in unlist(e$details$columns)) expect_true(grepl(cl, e$message, fixed = TRUE))
  expect_false(file.exists(file.path(attr(e, "run")$dir, "result.json.tmp")))
})

test_that("empty cells in a mapped column -> REQUEST_INVALID (listwise-complete data expected)", {
  d <- tam_data()
  d$pu2[c(3, 9)] <- NA
  d$pu1[1] <- 3.14159271
  e <- run_err(make_job(tam()$model, pls_analysis(), d), "REQUEST_INVALID")
  expect_equal(e$details$reason, "missing-values")
  expect_equal(unlist(e$details$columns), "pu2")
  expect_no_values(e, c("3.14159"))
})

test_that("text column -> DATA_NOT_NUMERIC without echoing the text", {
  d <- tam_data()
  d$bi2 <- as.character(d$bi2)
  d$bi2[7] <- "SECRETVALUE"
  d$bi2[8] <- "n/a"
  e <- run_err(make_job(tam()$model, pls_analysis(), d), "DATA_NOT_NUMERIC")
  expect_equal(unlist(e$details$columns), "bi2")
  expect_equal(unlist(e$details$nonNumericCells), 2L)
  expect_no_values(e, c("SECRETVALUE", "n/a"))
})

test_that("Inf / hex literals are not accepted as numbers", {
  d <- tam_data()
  d$bi2 <- as.character(d$bi2)
  d$bi2[1] <- "Inf"
  d$bi2[2] <- "0x1A"
  run_err(make_job(tam()$model, pls_analysis(), d), "DATA_NOT_NUMERIC")
})

test_that("zero variance -> DATA_ZERO_VARIANCE", {
  d <- tam_data()
  d$peou3 <- 7.77777
  e <- run_err(make_job(tam()$model, pls_analysis(), d), "DATA_ZERO_VARIANCE")
  expect_equal(unlist(e$details$columns), "peou3")
  expect_equal(unlist(e$details$indicatorIds), "i_peou3")
  expect_no_values(e, c("7.77777"))
})

test_that("fewer than 3 rows -> DATA_INSUFFICIENT_ROWS", {
  run_err(make_job(tam()$model, pls_analysis(), tam_data()[1:2, ]), "DATA_INSUFFICIENT_ROWS")
})

test_that("a structural cycle -> REQUEST_INVALID", {
  m <- tam()$model
  m$relationships[[length(m$relationships) + 1L]] <- list(id = "r_bi_peou", kind = "structural", sourceId = "c_bi", targetId = "c_peou")
  e <- run_err(make_job(m, pls_analysis(), tam()$data), "REQUEST_INVALID")
  expect_true(grepl("cycle", e$message))
})

test_that("an isolated construct -> MODEL_NOT_IDENTIFIED", {
  m <- tam()$model
  m$relationships <- m$relationships[1]   # only PEOU -> PU; BI isolated
  e <- run_err(make_job(m, pls_analysis(), tam()$data), "MODEL_NOT_IDENTIFIED")
  expect_equal(unlist(e$details$constructIds), "c_bi")
})

test_that("capabilities the registry does not offer for r-csem -> CAPABILITY_UNSUPPORTED", {
  # BCa intervals: registry status "planned"
  a <- pls_analysis(bootstrap = list(ci = "bca", repetitions = 50L))
  e <- run_err(make_job(tam()$model, a, tam()$data), "CAPABILITY_UNSUPPORTED")
  expect_equal(e$details$capabilityId, "resampling.bootstrap-bca")
  expect_equal(e$details$status, "planned")
  # IPMA: planned
  a2 <- pls_analysis()
  a2$ipma <- list(targetConstructId = "c_bi")
  e2 <- run_err(make_job(tam()$model, a2, tam()$data), "CAPABILITY_UNSUPPORTED")
  expect_equal(e2$details$capabilityId, "ipma.construct")
  # higher-order constructs: planned
  m <- tam()$model
  m$constructs[[1]]$higherOrder <- list(approach = "two-stage", childConstructIds = I("c_pu"))
  e3 <- run_err(make_job(m, pls_analysis(), tam()$data), "CAPABILITY_UNSUPPORTED")
  expect_equal(e3$details$capabilityId, "pls.higher-order")
  # CB-SEM is not run by this engine
  a4 <- pls_analysis(); a4$method <- "cb-sem"; a4$pls <- NULL
  run_err(make_job(tam()$model, a4, tam()$data), "CAPABILITY_UNSUPPORTED")
  # weighting-mode override that differs from the measurement kind
  m5 <- tam()$model
  m5$constructs[[1]]$plsWeightingMode <- "mode-b"
  run_err(make_job(m5, pls_analysis("plsc"), tam()$data), "CAPABILITY_UNSUPPORTED")
  # indicator residual covariance
  m6 <- tam()$model
  m6$relationships[[length(m6$relationships) + 1L]] <- list(id = "r_cov", kind = "covariance", sourceId = "i_pu1", targetId = "i_pu2")
  run_err(make_job(m6, pls_analysis(), tam()$data), "CAPABILITY_UNSUPPORTED")
})

test_that("a registry capability marked unsupported is refused (registry override)", {
  reg <- read_json_list(file.path(REPO_DIR, "packages", "method-registry", "registry.json"))
  for (i in seq_along(reg$capabilities)) {
    if (reg$capabilities[[i]]$id == "pls.inner-weighting.centroid") {
      reg$capabilities[[i]]$engines$`r-csem`$status <- "planned"
      reg$capabilities[[i]]$engines$`r-csem`$reason <- "test override"
    }
  }
  f <- tempfile(fileext = ".json")
  writeLines(jsonlite::toJSON(reg, auto_unbox = TRUE, null = "null", digits = NA), f)
  old <- Sys.getenv("SEM_STUDIO_REGISTRY")
  Sys.setenv(SEM_STUDIO_REGISTRY = f)
  on.exit(Sys.setenv(SEM_STUDIO_REGISTRY = old))
  e <- run_err(make_job(tam()$model, pls_analysis(scheme = "centroid"), tam()$data), "CAPABILITY_UNSUPPORTED")
  expect_equal(e$details$capabilityId, "pls.inner-weighting.centroid")
})

test_that("request problems -> REQUEST_INVALID", {
  run_err(make_job(tam()$model, pls_analysis(), tam()$data, request_override = list(protocolVersion = 2L)), "REQUEST_INVALID")
  a <- pls_analysis(); a$engine <- "r-seminr"
  run_err(make_job(tam()$model, a, tam()$data), "REQUEST_INVALID")
  a <- pls_analysis(); a$pls <- NULL
  run_err(make_job(tam()$model, a, tam()$data), "REQUEST_INVALID")
  a <- pls_analysis(bootstrap = list(repetitions = 100L)); a$seed <- NULL
  run_err(make_job(tam()$model, a, tam()$data), "REQUEST_INVALID")
  a <- pls_analysis(bootstrap = list(repetitions = 20000L))
  run_err(make_job(tam()$model, a, tam()$data), "REQUEST_INVALID")   # > limits.maxBootstrap
  m <- set_indicator(tam()$model, "i_pu1", column = NULL)
  run_err(make_job(m, pls_analysis(), tam()$data), "REQUEST_INVALID")
  m <- set_indicator(tam()$model, "i_pu1", reverseScored = TRUE, scale = NULL)   # no endpoints
  run_err(make_job(m, pls_analysis(), tam()$data), "REQUEST_INVALID")
})

test_that("non-convergence -> ENGINE_NONCONVERGENCE", {
  e <- run_err(make_job(tam()$model, pls_analysis(iter = 1L, tol = 1e-12), tam()$data), "ENGINE_NONCONVERGENCE")
  expect_equal(e$details$maxIterations, 1L)
})

test_that("a non-admissible original estimate is reported with admissible = false and a warning", {
  # PLSc on a tiny sample gives a standardized loading > 1 (Heywood-type) for this seed
  fx <- fixture("tam-mediation")
  d <- utils::read.csv(fx$data)
  found <- FALSE
  for (s in 1:40) {
    set.seed(s)
    ds <- d[sample(nrow(d), 25), ]
    fit <- suppressWarnings(cSEM::csem(ds, "A =~ peou1 + peou2 + peou3 + peou4\nB =~ pu1 + pu2 + pu3 + pu4\nC =~ bi1 + bi2 + bi3\nB ~ A\nC ~ A + B",
                                       .tolerance = 1e-7, .iter_max = 300L))
    if (isTRUE(fit$Information$Weight_info$Convergence_status) && sum(cSEM::verify(fit)) > 0) { found <- TRUE; break }
  }
  skip_if_not(found, "no inadmissible PLSc subsample found")
  r <- run_ok(make_job(fx$model, pls_analysis("plsc", tol = 1e-7), ds))
  expect_false(r$estimation$admissible)
  expect_true("INADMISSIBLE_SOLUTION" %in% vapply(r$warnings, function(w) w$code, ""))
})
