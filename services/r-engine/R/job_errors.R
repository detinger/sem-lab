# Stable engine error codes (docs/architecture/engine-protocol.md) and the condition
# class used to raise them.
#
# Rule: messages and details may name model ids, column names and counts. They must
# never contain a data value (no cell contents, no row-level numbers).

ENGINE_ERROR_CODES <- c(
  "REQUEST_INVALID", "DATA_COLUMN_MISSING", "DATA_NOT_NUMERIC", "DATA_INSUFFICIENT_ROWS",
  "DATA_ZERO_VARIANCE", "MODEL_NOT_IDENTIFIED", "ENGINE_NONCONVERGENCE", "ENGINE_INADMISSIBLE",
  "CAPABILITY_UNSUPPORTED", "CANCELLED", "TIMEOUT", "ENGINE_INTERNAL"
)

#' Raise a handled engine error. `details` is a named list that is written to
#' result.json as-is (keep it free of data values).
engine_error <- function(code, message, details = list()) {
  stopifnot(code %in% ENGINE_ERROR_CODES)
  cond <- structure(
    class = c("engine_error", "error", "condition"),
    list(message = message, call = NULL, code = code, details = details)
  )
  stop(cond)
}

is_engine_error <- function(e) inherits(e, "engine_error")

#' Make an arbitrary condition message safe for logs: numeric literals (which could be
#' data values or row numbers) are replaced by "#", and the text is shortened.
sanitize_message <- function(msg, max_chars = 300L) {
  msg <- paste(msg, collapse = " ")
  # keep alias-like tokens (C1, X12) intact; replace free-standing numbers
  msg <- gsub("(?<![A-Za-z_0-9.])[-+]?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?", "#", msg, perl = TRUE)
  msg <- gsub("[[:cntrl:]]+", " ", msg)
  if (nchar(msg) > max_chars) msg <- paste0(substr(msg, 1L, max_chars), "...")
  msg
}
