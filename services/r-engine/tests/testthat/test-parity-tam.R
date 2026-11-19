# Parity with the Phase 0 evidence (docs/validation/phase-0/evidence/r/parity_csem_*.json),
# which was produced by direct cSEM calls on tam-v1 (TEMP/Example - TAM/Data.txt).
# TEMP/ is git-ignored, so these tests are skipped when the data file is absent.

tam_blocks <- list(PU = paste0("USEF", 1:5), PEOU = paste0("EOU", 1:5), ATU = paste0("ATT", 1:5),
                   BI = paste0("BI", 1:3), USE = paste0("USE", 1:4))
tam_struct <- list(c("PEOU", "PU"), c("PEOU", "ATU"), c("PU", "ATU"), c("PU", "BI"), c("ATU", "BI"), c("BI", "USE"))

tam_model <- function() {
  list(
    constructs = lapply(names(tam_blocks), function(k) list(
      id = paste0("c_", tolower(k)), name = k, measurement = "reflective",
      indicatorIds = I(paste0("i_", tolower(tam_blocks[[k]]))))),
    indicators = lapply(unlist(tam_blocks, use.names = FALSE), function(col) list(
      id = paste0("i_", tolower(col)), name = col, column = col)),
    relationships = lapply(tam_struct, function(p) list(
      id = sprintf("r_%s_%s", tolower(p[1]), tolower(p[2])), kind = "structural",
      sourceId = paste0("c_", tolower(p[1])), targetId = paste0("c_", tolower(p[2]))))
  )
}

tam_csv <- function() {
  d <- utils::read.table(TAM_TXT, header = TRUE, sep = ";", dec = ".", check.names = FALSE)
  f <- tempfile(fileext = ".csv")
  utils::write.csv(d, f, row.names = FALSE)
  f
}

compare_parity <- function(r, ev) {
  dev <- c()
  for (p in ev$paths) dev <- c(dev, est(r, sprintf("path:c_%s->c_%s", tolower(p$from), tolower(p$to))) - p$est)
  for (l in ev$loadings) dev <- c(dev, est(r, sprintf("loading:c_%s:i_%s", tolower(l$construct), tolower(l$indicator))) - l$est)
  for (w in ev$weights) dev <- c(dev, est(r, sprintf("weight:c_%s:i_%s", tolower(w$construct), tolower(w$indicator))) - w$est)
  for (k in names(ev$r2)) dev <- c(dev, num(metric(r, paste0("c_", tolower(k)), "r2")$value) - ev$r2[[k]])
  for (k in names(ev$extra$r2adj)) dev <- c(dev, num(metric(r, paste0("c_", tolower(k)), "r2-adjusted")$value) - ev$extra$r2adj[[k]])
  dev
}

test_that("classic PLS equals Phase 0 parity evidence (path, centroid, factorial)", {
  skip_if_not(file.exists(TAM_TXT), "TEMP/Example - TAM/Data.txt not present (git-ignored)")
  csv <- tam_csv()
  for (s in c("path", "centroid", "factorial")) {
    ev <- read_json_list(file.path(EVIDENCE, sprintf("parity_csem_pls-modeA-%s.json", s)))
    r <- run_ok(make_job(tam_model(), pls_analysis("pls-sem", scheme = s, tol = ev$options$.tolerance,
                                                   iter = ev$options$.iter_max), csv))
    dev <- compare_parity(r, ev)
    for (k in names(ev$extra$ave)) {
      cid <- paste0("c_", tolower(k))
      dev <- c(dev, num(metric(r, cid, "ave")$value) - ev$extra$ave[[k]],
               num(metric(r, cid, "rho-c")$value) - ev$extra$rhoC[[k]],
               num(metric(r, cid, "cronbach-alpha")$value) - ev$extra$cronbachAlpha[[k]])
    }
    cat(sprintf("\n[parity] classic %s: %d numbers, max |dev| = %.3g\n", s, length(dev), max(abs(dev))))
    expect_lt(max(abs(dev)), 1e-10)
    expect_equal(r$estimation$iterations, ev$extra$iterations)
  }
})

test_that("PLSc equals Phase 0 parity evidence; classic rho_A equals the PLSc rho_A", {
  skip_if_not(file.exists(TAM_TXT), "TEMP/Example - TAM/Data.txt not present (git-ignored)")
  csv <- tam_csv()
  ev <- read_json_list(file.path(EVIDENCE, "parity_csem_plsc.json"))
  r <- run_ok(make_job(tam_model(), pls_analysis("plsc", scheme = ev$options$.PLS_weight_scheme_inner,
                                                 tol = ev$options$.tolerance, iter = ev$options$.iter_max), csv))
  dev <- compare_parity(r, ev)
  for (k in names(ev$extra$rhoA)) dev <- c(dev, num(metric(r, paste0("c_", tolower(k)), "rho-a")$value) - ev$extra$rhoA[[k]])
  cat(sprintf("\n[parity] PLSc: %d numbers, max |dev| = %.3g\n", length(dev), max(abs(dev))))
  expect_lt(max(abs(dev)), 1e-10)
  # classic run: rho_A comes from the auxiliary PLSc fit, never the classic object's 1
  rc <- run_ok(make_job(tam_model(), pls_analysis("pls-sem", tol = ev$options$.tolerance, iter = ev$options$.iter_max), csv))
  d2 <- vapply(names(ev$extra$rhoA), function(k) num(metric(rc, paste0("c_", tolower(k)), "rho-a")$value) - ev$extra$rhoA[[k]], 0)
  expect_lt(max(abs(d2)), 1e-10)
  expect_true(all(vapply(names(ev$extra$rhoA), function(k) num(metric(rc, paste0("c_", tolower(k)), "rho-a")$value) < 1, TRUE)))
})
