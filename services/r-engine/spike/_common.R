# Shared helpers for the Phase 0 R capability spike.
#
# Sourced by every script in services/r-engine/spike/. Not an engine module:
# nothing in services/r-engine/R may depend on this file.
#
# Scripts are run from anywhere as
#   services/r-engine/bin/rscript services/r-engine/spike/<name>.R

suppressPackageStartupMessages(library(jsonlite))

.spike_file <- local({
  a <- commandArgs(trailingOnly = FALSE)
  f <- sub("^--file=", "", a[grepl("^--file=", a)][1])
  if (is.na(f)) stop("spike scripts must be run with Rscript (via services/r-engine/bin/rscript)")
  normalizePath(f, mustWork = TRUE)
})
SPIKE_NAME   <- sub("\\.R$", "", basename(.spike_file))
ENGINE_DIR   <- normalizePath(file.path(dirname(.spike_file), ".."), mustWork = TRUE)
REPO_ROOT    <- normalizePath(file.path(ENGINE_DIR, "..", ".."), mustWork = TRUE)
EVIDENCE_DIR <- file.path(REPO_ROOT, "docs", "validation", "phase-0", "evidence", "r")
TAM_DATA     <- file.path(REPO_ROOT, "TEMP", "Example - TAM", "Data.txt")
dir.create(EVIDENCE_DIR, recursive = TRUE, showWarnings = FALSE)

# The project library must be the first library path, otherwise the evidence
# would not describe the pinned environment.
stopifnot(identical(normalizePath(.libPaths()[1]), normalizePath(file.path(ENGINE_DIR, "r-lib"))))

# ---- tam-v1: SEM Studio's own specification of the Technology Acceptance Model
TAM_BLOCKS <- list(
  PU   = paste0("USEF", 1:5),
  PEOU = paste0("EOU", 1:5),
  ATU  = paste0("ATT", 1:5),
  BI   = paste0("BI", 1:3),
  USE  = paste0("USE", 1:4)
)
# structural: PU ~ PEOU ; ATU ~ PEOU + PU ; BI ~ PU + ATU ; USE ~ BI
TAM_STRUCT <- list(PU = "PEOU", ATU = c("PEOU", "PU"), BI = c("PU", "ATU"), USE = "BI")
TAM_PATHS <- do.call(rbind, lapply(names(TAM_STRUCT), function(to) {
  data.frame(from = TAM_STRUCT[[to]], to = to, stringsAsFactors = FALSE)
}))
TAM_SCALE_MIN <- 1
TAM_SCALE_MAX <- 7

load_tam <- function() {
  d <- utils::read.table(TAM_DATA, header = TRUE, sep = ";", dec = ".", check.names = FALSE)
  stopifnot(nrow(d) == 1190, ncol(d) == 22, !anyNA(d), all(vapply(d, is.numeric, logical(1))))
  stopifnot(setequal(names(d), unlist(TAM_BLOCKS)))
  d
}

# cSEM / lavaan model syntax. `ops` gives the measurement operator per construct
# ("=~" common factor, "<~" composite); a single value is recycled.
tam_model_syntax <- function(ops = "=~", structural = TRUE) {
  ops <- rep_len(ops, length(TAM_BLOCKS))
  if (is.null(names(ops))) names(ops) <- names(TAM_BLOCKS)
  meas <- vapply(names(TAM_BLOCKS), function(k) {
    paste0(k, " ", ops[[k]], " ", paste(TAM_BLOCKS[[k]], collapse = " + "))
  }, character(1))
  struct <- if (structural) vapply(names(TAM_STRUCT), function(k) {
    paste0(k, " ~ ", paste(TAM_STRUCT[[k]], collapse = " + "))
  }, character(1)) else character(0)
  paste(c("# measurement", meas, if (structural) "# structural", struct), collapse = "\n")
}

# ---- condition capture -------------------------------------------------------
# Evaluates expr, returns list(ok, value | error, warnings, messages, seconds).
try_capture <- function(expr) {
  warns <- character(0)
  msgs <- character(0)
  t0 <- proc.time()[["elapsed"]]
  out <- withCallingHandlers(
    tryCatch(
      list(ok = TRUE, value = expr),
      error = function(e) list(ok = FALSE, error = conditionMessage(e), error_class = class(e)[1])
    ),
    warning = function(w) {
      warns <<- c(warns, conditionMessage(w))
      invokeRestart("muffleWarning")
    },
    message = function(m) {
      msgs <<- c(msgs, conditionMessage(m))
      invokeRestart("muffleMessage")
    }
  )
  out$warnings <- as.list(unique(warns))
  out$n_warnings <- length(warns)
  out$messages <- as.list(unique(trimws(msgs)))
  out$seconds <- proc.time()[["elapsed"]] - t0
  out
}
# Same, but drops the (possibly huge) value: for evidence records.
status_of <- function(tc, keep = NULL) {
  s <- tc[setdiff(names(tc), "value")]
  if (!is.null(keep) && isTRUE(tc$ok)) s$result <- keep(tc$value)
  s
}

# ---- JSON helpers ------------------------------------------------------------
# matrix -> { rowname: { colname: value } }   (dimnames survive JSON)
mat_named <- function(m) {
  m <- as.matrix(m)
  if (is.null(rownames(m))) rownames(m) <- as.character(seq_len(nrow(m)))
  if (is.null(colnames(m))) colnames(m) <- as.character(seq_len(ncol(m)))
  out <- lapply(seq_len(nrow(m)), function(i) as.list(stats::setNames(as.numeric(m[i, ]), colnames(m))))
  stats::setNames(out, rownames(m))
}
vec_named <- function(v) as.list(stats::setNames(as.numeric(v), names(v)))
df_rows <- function(d) {
  d <- as.data.frame(d, stringsAsFactors = FALSE)
  rownames(d) <- NULL
  d
}
formals_of <- function(f) {
  fm <- formals(f)
  lapply(fm, function(x) {
    s <- paste(deparse(x, width.cutoff = 500L), collapse = " ")
    if (identical(s, "")) "<no default>" else s
  })
}
pkg_ver <- function(p) as.character(utils::packageVersion(p))

write_json_file <- function(obj, file) {
  txt <- jsonlite::toJSON(obj, digits = NA, auto_unbox = TRUE, na = "null", null = "null", pretty = TRUE, force = TRUE)
  if (grepl("\\bNaN\\b|\\bInf\\b", gsub("\"[^\"]*\"", "\"\"", txt))) stop("NaN/Inf leaked into JSON: ", file)
  writeLines(txt, file, useBytes = TRUE)
  cat("wrote ", sub(paste0("^", REPO_ROOT, "/"), "", file), " (", file.size(file), " bytes)\n", sep = "")
  invisible(file)
}

write_evidence <- function(name, findings, packages = character(0)) {
  obj <- list(
    evidence = name,
    script = paste0("services/r-engine/spike/", basename(.spike_file)),
    generated = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z"),
    r = R.version.string,
    platform = R.version$platform,
    packages = as.list(stats::setNames(vapply(packages, pkg_ver, character(1)), packages)),
    findings = findings
  )
  write_json_file(obj, file.path(EVIDENCE_DIR, paste0(name, ".json")))
}

# Parity file: the exact shape every engine (R and Python) dumps for tam-v1.
write_parity <- function(engine, variant, options, paths, loadings, weights, r2, extra = list(), n = 1190L) {
  stopifnot(is.data.frame(paths), all(c("from", "to", "est") %in% names(paths)))
  stopifnot(is.data.frame(loadings), all(c("construct", "indicator", "est") %in% names(loadings)))
  stopifnot(is.null(weights) || all(c("construct", "indicator", "est") %in% names(weights)))
  obj <- list(
    model = "tam-v1",
    engine = engine,
    engineVersion = pkg_ver(engine),
    variant = variant,
    options = options,
    n = n,
    paths = df_rows(paths[, c("from", "to", "est")]),
    loadings = df_rows(loadings[, c("construct", "indicator", "est")]),
    weights = if (is.null(weights)) list() else df_rows(weights[, c("construct", "indicator", "est")]),
    r2 = as.list(r2),
    extra = extra
  )
  write_json_file(obj, file.path(EVIDENCE_DIR, paste0("parity_", tolower(engine), "_", variant, ".json")))
}

# ---- cSEM result extraction (tam-v1 ordering) ----------------------------------
csem_paths_df <- function(res) {
  P <- res$Estimates$Path_estimates
  data.frame(from = TAM_PATHS$from, to = TAM_PATHS$to,
             est = mapply(function(f, t) P[t, f], TAM_PATHS$from, TAM_PATHS$to),
             stringsAsFactors = FALSE, row.names = NULL)
}
csem_block_df <- function(M) {
  do.call(rbind, lapply(names(TAM_BLOCKS), function(k) {
    data.frame(construct = k, indicator = TAM_BLOCKS[[k]], est = as.numeric(M[k, TAM_BLOCKS[[k]]]),
               stringsAsFactors = FALSE)
  }))
}
max_abs_diff <- function(a, b) max(abs(as.numeric(a) - as.numeric(b)))
