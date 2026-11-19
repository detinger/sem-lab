# Job-directory I/O: timestamps, JSON encoding, atomic result writing, progress lines,
# technical log lines, cancellation flag.

#' ISO 8601 timestamp in UTC with millisecond precision and an explicit "Z" offset.
iso_now <- function(time = Sys.time()) {
  format(time, "%Y-%m-%dT%H:%M:%OS3Z", tz = "UTC")
}

#' Encode an R object as JSON the way every engine file is written:
#' digits = I(17) (17 significant digits: every double round-trips exactly), auto_unbox,
#' NA -> null. Length-1 arrays must be wrapped in I() by the caller.
to_json <- function(obj, pretty = FALSE) {
  jsonlite::toJSON(obj, digits = I(17), auto_unbox = TRUE, na = "null", null = "null",
                   pretty = pretty, force = FALSE)
}

#' Recursively verify that no NaN / Inf remains (NA is allowed: it becomes null and
#' the builder that produced it is responsible for the missing reason).
assert_no_nonfinite <- function(obj, where = "result") {
  if (is.numeric(obj)) {
    bad <- is.nan(obj) | (is.infinite(obj))
    if (any(bad)) stop("non-finite number at ", where)
    return(invisible(TRUE))
  }
  if (is.list(obj)) {
    nm <- names(obj)
    for (i in seq_along(obj)) {
      assert_no_nonfinite(obj[[i]], paste0(where, "/", if (!is.null(nm) && nzchar(nm[i])) nm[i] else i))
    }
  }
  invisible(TRUE)
}

#' Write `obj` to `path` atomically: <path>.tmp then rename.
write_json_atomic <- function(obj, path) {
  txt <- to_json(obj)
  tmp <- paste0(path, ".tmp")
  con <- file(tmp, open = "wb")
  writeBin(charToRaw(enc2utf8(as.character(txt))), con)
  close(con)
  if (!file.rename(tmp, path)) stop("could not rename result.json.tmp to result.json")
  invisible(path)
}

#' Progress writer bound to a job directory. Each call appends one NDJSON line and
#' closes the connection, which flushes it.
make_progress <- function(job_dir) {
  path <- file.path(job_dir, "progress.ndjson")
  function(stage, done = NULL, total = NULL, failed = NULL, inadmissible = NULL) {
    stopifnot(stage %in% c("validating", "estimating", "bootstrapping", "summarizing"))
    ev <- list(t = iso_now(), stage = stage)
    if (!is.null(done)) ev$done <- as.integer(done)
    if (!is.null(total)) ev$total <- as.integer(total)
    if (!is.null(failed)) ev$failed <- as.integer(failed)
    if (!is.null(inadmissible)) ev$inadmissible <- as.integer(inadmissible)
    con <- file(path, open = "ab")
    writeBin(charToRaw(paste0(as.character(to_json(ev)), "\n")), con)
    close(con)
    invisible(ev)
  }
}

#' Technical log line on stderr (the API redirects it to engine.log).
#' Callers pass ids, counts and stage names only: never data values.
log_line <- function(...) {
  cat(iso_now(), " ", ..., "\n", sep = "", file = stderr())
  flush(stderr())
}

cancel_requested <- function(job_dir) file.exists(file.path(job_dir, "cancel"))
