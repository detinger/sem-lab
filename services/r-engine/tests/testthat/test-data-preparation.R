# Rows removed in the browser before upload are declared in request.dataPreparation and
# reported back in result.sample, so "N of M rows used" survives (Phase 4 fix).

tam <- function() fixture("tam-mediation")
tam_data <- function() utils::read.csv(tam()$data)

test_that("a consistent dataPreparation is reported as nRows / nDropped", {
  d <- tam_data()
  n <- nrow(d)
  r <- run_ok(make_job(tam()$model, pls_analysis(), d,
                       request_override = list(dataPreparation = list(nRows = n + 25L, nDropped = 25L, missingData = "listwise"))))
  expect_equal(r$sample$nRows, n + 25L)
  expect_equal(r$sample$nUsed, n)
  expect_equal(r$sample$nDropped, 25L)
})

test_that("without dataPreparation the sample block describes the uploaded rows only", {
  d <- tam_data()
  r <- run_ok(make_job(tam()$model, pls_analysis(), d))
  expect_equal(r$sample$nRows, nrow(d))
  expect_equal(r$sample$nDropped, 0L)
})

test_that("an inconsistent declaration is refused instead of being reported", {
  d <- tam_data()
  e <- run_err(make_job(tam()$model, pls_analysis(), d,
                        request_override = list(dataPreparation = list(nRows = nrow(d) + 5L, nDropped = 1L, missingData = "listwise"))),
               "REQUEST_INVALID")
  expect_equal(e$details$reason, "data-preparation-mismatch")
})
