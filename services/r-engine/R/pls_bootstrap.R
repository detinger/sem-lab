# Chunked, seeded bootstrap (docs/architecture/engine-protocol.md "Bootstrap chunking").
#
#   - B requested draws are taken in chunks of size min(chunkSize, remaining).
#   - Chunk k (k = 0, 1, 2, ...) calls cSEM::resamplecSEMResults() with
#     .seed = (seed + k) mod (2^31 - 1), .handle_inadmissibles = "drop",
#     .sign_change_option = "none", .eval_plan = "sequential".
#   - If a chunk call errors (cSEM aborts the whole call when one replication errors,
#     and errors when fewer than 2 admissible draws remain under "drop"), or the chunk
#     has fewer than 3 draws (resamplecSEMResults needs at least 3), the chunk is
#     re-run one draw at a time: draw j (j = 1..r) uses
#     set.seed((seed + k + j * 1e6) mod (2^31 - 1)) [Mersenne-Twister, Inversion,
#     Rejection], rows sample.int(n, n, replace = TRUE), csem() with the same options;
#     an error counts as failed, a verify() failure as inadmissible. The global RNG
#     state is restored afterwards.
#   - inadmissible (per chunk) = requested in chunk - returned - failed.
#   - Draws whose parameter vector contains a non-finite value are counted as failed.
#   - Intervals are computed once, from the concatenated valid draws.

SEED_MOD <- 2147483647

chunk_seed <- function(seed, k) as.integer((seed + k) %% SEED_MOD)
draw_seed <- function(seed, k, j) as.integer((seed + k + j * 1e6) %% SEED_MOD)

with_seed <- function(seed, expr) {
  had <- exists(".Random.seed", envir = globalenv(), inherits = FALSE)
  old <- if (had) get(".Random.seed", envir = globalenv(), inherits = FALSE) else NULL
  on.exit({
    if (had) assign(".Random.seed", old, envir = globalenv())
    else if (exists(".Random.seed", envir = globalenv(), inherits = FALSE)) rm(".Random.seed", envir = globalenv())
  })
  set.seed(seed, kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection")
  expr
}

resample_chunk <- function(fit, r, seed) {
  tryCatch(
    suppressMessages(suppressWarnings(cSEM::resamplecSEMResults(
      .object = fit, .resample_method = "bootstrap", .R = r, .seed = seed,
      .handle_inadmissibles = "drop", .sign_change_option = "none", .eval_plan = "sequential"))),
    error = function(e) {
      log_line("bootstrap chunk (", r, " draws) errored; re-running it draw by draw: ", sanitize_message(conditionMessage(e), 200L))
      NULL
    }
  )
}

extract_theta_resample <- function(res, ts) {
  E <- res$Estimates$Estimates_resample$Estimates1
  src <- list(Path_estimates = E$Path_estimates$Resampled, Loading_estimates = E$Loading_estimates$Resampled,
              Weight_estimates = E$Weight_estimates$Resampled)
  n <- nrow(src$Path_estimates)
  if (is.null(n)) n <- 0L
  M <- matrix(NA_real_, n, nrow(ts), dimnames = list(NULL, ts$key))
  for (i in seq_len(nrow(ts))) {
    S <- src[[ts$mat[i]]]
    if (!ts$resample_col[i] %in% colnames(S)) stop("resampled draws lack column ", ts$resample_col[i])
    M[, i] <- S[, ts$resample_col[i]]
  }
  M
}

one_draw <- function(data, model, opts, ts, seed) {
  n <- nrow(data)
  idx <- with_seed(seed, sample.int(n, n, replace = TRUE))
  fit <- tryCatch(
    suppressMessages(suppressWarnings(do.call(cSEM::csem, c(list(.data = data[idx, , drop = FALSE], .model = model), opts)))),
    error = function(e) NULL)
  if (is.null(fit)) return(list(status = "failed"))
  if (any(verify_flags(fit))) return(list(status = "inadmissible"))
  list(status = "ok", theta = extract_theta_fit(fit, ts))
}

#' Run the bootstrap. Returns list(draws [valid x keys], requested, completed, failed,
#' inadmissible, chunk_size, calls). Honours the cancel file and the timeout between chunks.
run_bootstrap <- function(spec, est, data, model, ts, progress, job_dir, deadline) {
  B <- spec$bootstrap$reps
  cs <- spec$limits$chunk_size
  seed <- spec$bootstrap$seed
  done <- 0L; failed <- 0L; inadm <- 0L; k <- 0L
  parts <- list()
  progress("bootstrapping", done = 0L, total = B, failed = 0L, inadmissible = 0L)
  while (done < B) {
    if (cancel_requested(job_dir)) engine_error("CANCELLED", "The job was cancelled during bootstrapping.", list(done = done, total = B))
    if (Sys.time() > deadline) engine_error("TIMEOUT", "The job exceeded limits.timeoutSeconds during bootstrapping.", list(done = done, total = B))
    r <- min(cs, B - done)
    res <- if (r >= 3L) resample_chunk(est$fit, r, chunk_seed(seed, k)) else NULL
    M <- if (!is.null(res)) tryCatch(extract_theta_resample(res, ts), error = function(e) NULL) else NULL
    if (!is.null(M)) {
      ok <- apply(M, 1L, function(x) all(is.finite(x)))
      f_k <- sum(!ok)
      parts[[length(parts) + 1L]] <- M[ok, , drop = FALSE]
      failed <- failed + f_k
      inadm <- inadm + (r - nrow(M))
    } else {
      rows <- list()
      for (j in seq_len(r)) {
        o <- one_draw(data, model, est$opts, ts, draw_seed(seed, k, j))
        if (o$status == "failed") failed <- failed + 1L
        else if (o$status == "inadmissible") inadm <- inadm + 1L
        else if (!all(is.finite(o$theta))) failed <- failed + 1L
        else rows[[length(rows) + 1L]] <- o$theta
      }
      if (length(rows)) parts[[length(parts) + 1L]] <- do.call(rbind, rows)
    }
    done <- done + r
    k <- k + 1L
    progress("bootstrapping", done = done, total = B, failed = failed, inadmissible = inadm)
  }
  draws <- if (length(parts)) do.call(rbind, parts) else matrix(NA_real_, 0L, nrow(ts), dimnames = list(NULL, ts$key))
  colnames(draws) <- ts$key
  stopifnot(nrow(draws) + failed + inadm == B)
  list(draws = draws, requested = B, completed = nrow(draws), failed = failed, inadmissible = inadm,
       chunk_size = cs, n_chunks = k)
}
