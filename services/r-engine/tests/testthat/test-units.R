# Unit tests of pure helpers (sourced directly, no engine process).

local({
  for (f in c("job_errors.R", "job_io.R", "registry.R", "model_graph.R", "job_validate.R", "pls_alias.R",
              "pls_estimate.R", "pls_results.R", "pls_bootstrap.R")) {
    sys.source(file.path(ENGINE_DIR, "R", f), envir = globalenv())
  }
})

test_that("cycle detection and path enumeration", {
  n <- c("a", "b", "c", "d")
  expect_null(find_cycle(n, c("a", "a", "b", "c"), c("b", "c", "c", "d")))
  cy <- find_cycle(n, c("a", "b", "c"), c("b", "c", "a"))
  expect_equal(cy[1], cy[length(cy)])
  ps <- all_paths(n, c("a", "a", "b", "c"), c("b", "c", "c", "d"), "a", "d")
  expect_setequal(vapply(ps, paste, "", collapse = ">"), c("a>b>c>d", "a>c>d"))
  cp <- connected_pairs(n, c("a", "a", "b", "c"), c("b", "c", "c", "d"))
  spec_keys <- unlist(lapply(cp$pairs, function(p) vapply(p$specific, paste, "", collapse = ">")))
  expect_setequal(spec_keys, c("a>b>c", "a>b>c>d", "a>c>d", "b>c>d"))
})

test_that("total = direct + sum of specific indirect effects (per draw)", {
  spec <- list(constructs = list(a = 1, b = 1, c = 1, d = 1),
               paths = data.frame(source = c("a", "a", "b", "c", "a"), target = c("b", "c", "c", "d", "d")))
  es <- effects_spec(spec)
  set.seed(1)
  P <- matrix(stats::runif(5 * 7, -1, 1), 7, 5, dimnames = list(NULL, sprintf("path:%s->%s", spec$paths$source, spec$paths$target)))
  ef <- compute_effects(P, spec, es)
  pr <- vapply(es$pairs, function(p) paste(p$source, p$target), "")
  j <- match("a d", pr)
  sk <- vapply(es$specific, `[[`, "", "key")
  sp_ad <- rowSums(ef$specific[, grepl("^specific-indirect:a->.*->d$", sk), drop = FALSE])
  expect_equal(ef$indirect[, j], sp_ad, tolerance = 1e-14)
  expect_equal(ef$total[, j], P[, "path:a->d"] + sp_ad, tolerance = 1e-14)
})

test_that("alias de-aliasing is single pass and syntax contains aliases only", {
  al <- list(construct_id = c(C1 = "C2", C2 = "c_x"), indicator_id = c(X1 = "i_1"))
  expect_equal(dealias_text("C1 ~ C2; X1 and C12", al), "C2 ~ c_x; i_1 and C12")
  spec <- list(constructs = list(a = list(id = "a", measurement = "reflective", indicator_ids = c("i1", "i2")),
                                 b = list(id = "b", measurement = "composite-formative", indicator_ids = "i3")),
               indicator_ids = c("i1", "i2", "i3"),
               paths = data.frame(id = "r", source = "a", target = "b", stringsAsFactors = FALSE))
  al2 <- build_aliases(spec)
  expect_equal(build_csem_model(spec, al2), "C1 =~ X1 + X2\nC2 <~ X3\nC2 ~ C1")
})

test_that("sanitized messages carry no numbers but keep aliases", {
  expect_equal(sanitize_message("rows 12, 7.5e-3 and C12 / X3 failed"), "rows #, # and C12 / X3 failed")
})

test_that("JSON writer refuses NaN/Inf and keeps length-1 arrays", {
  expect_error(assert_no_nonfinite(list(a = list(b = c(1, NaN)))), "non-finite")
  expect_error(assert_no_nonfinite(list(a = Inf)), "non-finite")
  expect_silent(assert_no_nonfinite(list(a = NA_real_, b = 1)))
  expect_equal(as.character(to_json(list(x = I("a"), y = NA_real_))), "{\"x\":[\"a\"],\"y\":null}")
})

test_that("bootstrap inference helper: definitions", {
  set.seed(3)
  d <- stats::rnorm(500, 0.4, 0.1)
  inf <- infer_from_draws(0.41, d, list(level = 0.9, sides = "two-sided"))
  expect_equal(inf$se, stats::sd(d))
  expect_equal(inf$pValue, 2 * stats::pt(-abs(0.41 / stats::sd(d)), 499))
  expect_equal(c(inf$ciLower, inf$ciUpper), unname(stats::quantile(d, c(0.05, 0.95), type = 7)))
  neg <- infer_from_draws(-0.41, -d, list(level = 0.9, sides = "one-sided"))
  expect_null(neg$ciLower)
  expect_equal(neg$ciUpper, unname(stats::quantile(-d, 0.9, type = 7)))
  few <- infer_from_draws(0.4, 0.3, list(level = 0.95, sides = "two-sided"))
  expect_equal(few$reason, "failed")
})

test_that("seeds wrap modulo 2^31 - 1", {
  expect_equal(chunk_seed(2147483646, 3), 2L)
  expect_equal(chunk_seed(5, 2), 7L)
  expect_true(draw_seed(2147483647 - 1, 0, 1) >= 0)
})
