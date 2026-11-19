# Hostile labels: construct/indicator names and column names are data. They never
# reach R code or cSEM syntax (aliases C1..Ck / X1..Xp), so injection attempts are inert
# and estimates are identical to a run with clean names.

test_that("hostile names and column names estimate normally and execute nothing", {
  fx <- fixture("tam-mediation")
  canary <- file.path(tempdir(), paste0("pwned-", Sys.getpid()))
  unlink(canary)
  hostile_cols <- c(
    sprintf("x\"); file.create(\"%s\"); (\"", canary),
    "x\"); system(\"echo pwned",
    "Größe ✓ 1",
    "two words",
    "`rm -rf ~`",
    "a,b",
    "PU ~ PEOU",
    "=~ <~ +",
    "'; DROP TABLE x; --",
    "\\n newline? ",
    "$(touch /tmp/x)"
  )
  d <- utils::read.csv(fx$data, check.names = FALSE)
  stopifnot(ncol(d) == length(hostile_cols))
  names(d) <- hostile_cols
  m <- fx$model
  for (i in seq_along(m$indicators)) {
    m$indicators[[i]]$column <- hostile_cols[i]
    m$indicators[[i]]$name <- paste0(hostile_cols[i], " name")
    m$indicators[[i]]$label <- hostile_cols[(i %% length(hostile_cols)) + 1L]
  }
  m$constructs[[1]]$name <- sprintf("x\"); file.create(\"%s\"); (\"", canary)
  m$constructs[[2]]$name <- "Wahrnehmung — Nützlichkeit ✓"
  m$constructs[[3]]$name <- "C1"   # collides with an alias name on purpose
  r_clean <- run_ok(make_job(fx$model, pls_analysis("plsc"), fx$data))
  r_host <- run_ok(make_job(m, pls_analysis("plsc"), d))
  e1 <- vapply(r_clean$parameters, function(p) num(p$est), 0)
  e2 <- vapply(r_host$parameters, function(p) num(p$est), 0)
  expect_identical(vapply(r_clean$parameters, function(p) p$key, ""), vapply(r_host$parameters, function(p) p$key, ""))
  expect_lt(max(abs(e1 - e2)), 1e-12)
  expect_false(file.exists(canary))
  # no user text in the recorded call; only aliases
  expect_false(grepl("file.create|system|Größe|Nützlichkeit", r_host$provenance$call))
  expect_true(grepl("C1 =~ X1 + X2 + X3 + X4", r_host$provenance$call, fixed = TRUE))
})

test_that("hostile text in ids is rejected as REQUEST_INVALID before anything runs", {
  fx <- fixture("tam-mediation")
  m <- fx$model
  m$constructs[[1]]$id <- "c\"); system(\"echo pwned"
  run_err(make_job(m, pls_analysis(), fx$data), "REQUEST_INVALID")
})
