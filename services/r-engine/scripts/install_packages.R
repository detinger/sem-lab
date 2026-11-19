#!/usr/bin/env Rscript
# SEM Studio R engine - package installation.
#
# Installs the R engine's packages FROM SOURCE into services/r-engine/r-lib.
#
#   services/r-engine/bin/rscript services/r-engine/scripts/install_packages.R [options]
#
# Options
#   --set=required|optional|all   which package set to install (default: all)
#   --ncpus=<n>                   parallel package builds (default: 6)
#   --logdir=<dir>                per-package build logs (default: services/r-engine/install-logs)
#   --report=<file>               JSON report (default: <logdir>/install-report.json)
#   --repos=<url>                 CRAN mirror (default: https://cloud.r-project.org)
#
# Why source builds: the development machine runs Homebrew R, which is built
# with a different toolchain / BLAS / Fortran runtime than CRAN's R.framework.
# CRAN's prebuilt macOS binaries are linked against the CRAN toolchain and are
# not guaranteed to load in Homebrew R, so type = "source" is forced here.
#
# Required set : cSEM, lavaan, jsonlite, testthat, digest, renv
# Optional set : seminr (cross-check engine only; pulls DiagrammeR/igraph/V8).
#                A failure in the optional set is recorded in the report and
#                does NOT fail the script.
#
# Exit status: 0 when every REQUIRED package is installed and loads; 1 otherwise.
#
# This script uses base R only (it must run before jsonlite exists).

REQUIRED <- c("jsonlite", "digest", "lavaan", "cSEM", "testthat", "renv")
OPTIONAL <- c("seminr")

args <- commandArgs(trailingOnly = FALSE)
script_path <- sub("^--file=", "", args[grepl("^--file=", args)][1])
if (is.na(script_path)) stop("install_packages.R must be run with Rscript")
engine_dir <- normalizePath(file.path(dirname(script_path), ".."), mustWork = TRUE)

user_args <- commandArgs(trailingOnly = TRUE)
get_opt <- function(name, default) {
  hit <- user_args[startsWith(user_args, paste0("--", name, "="))]
  if (length(hit) == 0) return(default)
  sub(paste0("^--", name, "="), "", hit[length(hit)])
}
pkg_set <- get_opt("set", "all")
ncpus   <- as.integer(get_opt("ncpus", "6"))
logdir  <- get_opt("logdir", file.path(engine_dir, "install-logs"))
repos   <- get_opt("repos", "https://cloud.r-project.org")
if (!pkg_set %in% c("required", "optional", "all")) stop("--set must be required|optional|all")
if (is.na(ncpus) || ncpus < 1) stop("--ncpus must be a positive integer")

lib <- file.path(engine_dir, "r-lib")
dir.create(lib, recursive = TRUE, showWarnings = FALSE)
dir.create(logdir, recursive = TRUE, showWarnings = FALSE)
lib    <- normalizePath(lib)
logdir <- normalizePath(logdir)
report_file <- get_opt("report", file.path(logdir, "install-report.json"))

# The project library must be first; refuse to install anywhere else.
.libPaths(c(lib, .libPaths()))
stopifnot(identical(normalizePath(.libPaths()[1]), lib))

options(
  repos = c(CRAN = repos),
  Ncpus = ncpus,
  pkgType = "source",
  install.packages.check.source = "no",
  install.packages.compile.from.source = "always",
  timeout = 600
)

say <- function(...) {
  cat(format(Sys.time(), "%H:%M:%S"), " ", ..., "\n", sep = "")
  flush(stdout())
}

# ---- minimal JSON writer (base R only) --------------------------------------
json_str <- function(x) {
  x <- gsub("\\\\", "\\\\\\\\", x)
  x <- gsub("\"", "\\\\\"", x)
  x <- gsub("\n", "\\\\n", x)
  x <- gsub("\r", "\\\\r", x)
  x <- gsub("\t", "\\\\t", x)
  paste0("\"", x, "\"")
}
to_json <- function(x, indent = 0) {
  pad <- strrep("  ", indent)
  pad1 <- strrep("  ", indent + 1)
  if (is.null(x)) return("null")
  if (is.list(x)) {
    if (length(x) == 0) return(if (is.null(names(x))) "[]" else "{}")
    items <- vapply(x, to_json, character(1), indent = indent + 1)
    if (!is.null(names(x))) {
      body <- paste0(pad1, json_str(names(x)), ": ", items, collapse = ",\n")
      return(paste0("{\n", body, "\n", pad, "}"))
    }
    return(paste0("[\n", paste0(pad1, items, collapse = ",\n"), "\n", pad, "]"))
  }
  one <- function(v) {
    if (is.na(v)) "null"
    else if (is.logical(v)) tolower(as.character(v))
    else if (is.numeric(v)) format(v, digits = 15)
    else json_str(as.character(v))
  }
  if (length(x) == 1) return(one(x))
  paste0("[", paste(vapply(x, one, character(1)), collapse = ", "), "]")
}

installed_in_lib <- function() {
  ip <- utils::installed.packages(lib.loc = lib, noCache = TRUE)
  stats::setNames(ip[, "Version"], ip[, "Package"])
}

loads <- function(pkg) {
  # Load in a fresh process so a broken shared object cannot poison this one.
  rscript <- file.path(R.home("bin"), "Rscript")
  code <- sprintf(
    ".libPaths(c(%s, .libPaths())); suppressMessages(library(%s, character.only = TRUE)); cat('OK', as.character(packageVersion(%s)))",
    deparse(lib), deparse(pkg), deparse(pkg)
  )
  out <- suppressWarnings(system2(rscript, c("--vanilla", "-e", shQuote(code)), stdout = TRUE, stderr = TRUE))
  ok <- any(grepl("^OK ", out))
  list(ok = ok, output = if (ok) "" else paste(utils::tail(out, 15), collapse = "\n"))
}

install_set <- function(pkgs, label) {
  say("=== ", label, ": ", paste(pkgs, collapse = ", "), " ===")
  before <- installed_in_lib()
  t0 <- Sys.time()
  warn <- character(0)
  err <- NULL
  withCallingHandlers(
    tryCatch(
      utils::install.packages(
        pkgs, lib = lib, type = "source", dependencies = NA,
        Ncpus = ncpus, keep_outputs = logdir, quiet = FALSE
      ),
      error = function(e) err <<- conditionMessage(e)
    ),
    warning = function(w) {
      warn <<- c(warn, conditionMessage(w))
      invokeRestart("muffleWarning")
    }
  )
  secs <- as.numeric(difftime(Sys.time(), t0, units = "secs"))
  after <- installed_in_lib()
  new_pkgs <- setdiff(names(after), names(before))
  status <- lapply(stats::setNames(pkgs, pkgs), function(p) {
    if (!p %in% names(after)) return(list(installed = FALSE, version = NA, loads = FALSE, load_error = "not installed"))
    l <- loads(p)
    list(installed = TRUE, version = unname(after[p]), loads = l$ok, load_error = l$output)
  })
  for (p in pkgs) say(sprintf("  %-10s installed=%s loads=%s version=%s", p, status[[p]]$installed, status[[p]]$loads, status[[p]]$version))
  if (length(warn)) say("  warnings: ", paste(warn, collapse = " | "))
  if (!is.null(err)) say("  error: ", err)
  say(sprintf("  %s took %.1f s; %d packages added to library", label, secs, length(new_pkgs)))
  list(
    packages = as.list(pkgs), seconds = secs, n_added = length(new_pkgs), added = as.list(sort(new_pkgs)),
    warnings = as.list(warn), error = if (is.null(err)) NA else err, status = status
  )
}

say("R: ", R.version.string, " (", R.version$platform, ")")
say("library: ", lib)
say("logs: ", logdir)
say("repos: ", repos, "  Ncpus: ", ncpus, "  type: source")

report <- list(
  started = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z"),
  r_version = R.version.string,
  platform = R.version$platform,
  library = lib,
  repos = repos,
  ncpus = ncpus,
  type = "source",
  stages = list()
)

t_all <- Sys.time()
if (pkg_set %in% c("required", "all")) report$stages$required <- install_set(REQUIRED, "required")
if (pkg_set %in% c("optional", "all")) report$stages$optional <- install_set(OPTIONAL, "optional")
report$total_seconds <- as.numeric(difftime(Sys.time(), t_all, units = "secs"))
report$finished <- format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z")
report$n_packages_in_library <- length(installed_in_lib())

required_ok <- TRUE
if (!is.null(report$stages$required)) {
  required_ok <- all(vapply(report$stages$required$status, function(s) isTRUE(s$installed) && isTRUE(s$loads), logical(1)))
}
report$required_ok <- required_ok

writeLines(to_json(report), report_file)
say("report: ", report_file)
say(sprintf("total %.1f s; %d packages in library; required_ok=%s", report$total_seconds, report$n_packages_in_library, required_ok))
quit(status = if (required_ok) 0L else 1L, save = "no")
