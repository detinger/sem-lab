# Phase 0 spike - lock file and licenses for the project R library (task item 9).
#
#   1. renv::snapshot(type = "all") of services/r-engine/r-lib into services/r-engine/renv.lock
#      (project = a temporary directory, so renv creates no files in the repository besides the
#      lock file). If that fails, services/r-engine/r-packages.lock.json is written instead.
#   2. the lock file is checked against every DESCRIPTION in r-lib (name + exact Version).
#   3. License / Repository / NeedsCompilation fields from each DESCRIPTION.
#
# Evidence: docs/validation/phase-0/evidence/r/r_environment.json

source(file.path(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "_common.R"))

lib <- normalizePath(file.path(ENGINE_DIR, "r-lib"))
pkgs <- sort(list.dirs(lib, recursive = FALSE, full.names = FALSE))
pkgs <- pkgs[file.exists(file.path(lib, pkgs, "DESCRIPTION"))]
desc <- lapply(stats::setNames(nm = pkgs), function(p) {
  x <- read.dcf(file.path(lib, p, "DESCRIPTION"), fields = c("Package", "Version", "License", "Repository", "NeedsCompilation", "Imports", "Depends", "LinkingTo"))
  as.list(x[1, ])
})
lockfile <- file.path(ENGINE_DIR, "renv.lock")
proj <- tempfile("renv-snapshot-"); dir.create(proj)
snap <- try_capture(renv::snapshot(project = proj, library = lib, lockfile = lockfile, type = "all", prompt = FALSE, force = TRUE))
find <- list(library = sub(paste0("^", REPO_ROOT, "/"), "", lib), n_packages_in_library = length(pkgs), renv_version = pkg_ver("renv"))
find$renv_snapshot <- status_of(snap)
if (snap$ok && file.exists(lockfile)) {
  lk <- jsonlite::fromJSON(lockfile, simplifyVector = FALSE)
  locked <- vapply(lk$Packages, function(p) p$Version, character(1))
  mism <- pkgs[vapply(pkgs, function(p) !identical(unname(locked[p]), desc[[p]]$Version), logical(1))]
  find$lockfile <- list(
    written = "services/r-engine/renv.lock",
    r_version_in_lock = lk$R$Version,
    repositories = lk$R$Repositories,
    n_packages_locked = length(locked),
    missing_from_lock = setdiff(pkgs, names(locked)),
    extra_in_lock = setdiff(names(locked), pkgs),
    version_mismatches = mism,
    sources = as.list(table(vapply(lk$Packages, function(p) if (is.null(p$Source)) "NA" else p$Source, character(1))))
  )
  clean <- length(find$lockfile$missing_from_lock) == 0 && length(mism) == 0
} else clean <- FALSE
if (!clean) {
  alt <- file.path(ENGINE_DIR, "r-packages.lock.json")
  write_json_file(list(r = R.version.string, platform = R.version$platform, library = "services/r-engine/r-lib",
                       packages = lapply(desc, function(x) list(Version = x$Version, Repository = x$Repository))), alt)
  find$fallback_written <- "services/r-engine/r-packages.lock.json"
}
unlink(proj, recursive = TRUE)

notable <- c("cSEM", "seminr", "lavaan", "matrixStats", "future", "future.apply", "parallelly", "mnormt", "pbivnorm", "numDeriv",
             "quadprog", "psych", "MASS", "Matrix", "polycor", "expm", "Rcpp", "RcppArmadillo", "lavaanPlot", "DiagrammeR", "igraph", "V8",
             "jsonlite", "digest", "renv", "testthat", "progressr", "dplyr", "ggplot2", "tidyr", "magrittr", "rlang")
base_lib <- .libPaths()[length(.libPaths())]
lic_of <- function(p) {
  if (p %in% pkgs) return(c(desc[[p]][c("Version", "License")], location = "r-lib"))
  f <- system.file("DESCRIPTION", package = p)
  if (nzchar(f)) { x <- read.dcf(f, fields = c("Version", "License"))[1, ]; return(list(Version = x[["Version"]], License = x[["License"]], location = dirname(dirname(f)))) }
  list(location = "not installed")
}
find$licenses_notable <- lapply(stats::setNames(nm = notable), lic_of)
find$licenses_all_r_lib <- lapply(desc, function(x) x$License)
find$license_summary <- as.list(sort(table(vapply(desc, function(x) x$License, character(1))), decreasing = TRUE))
find$direct_dependencies <- lapply(desc[intersect(c("cSEM", "seminr", "lavaan"), pkgs)], function(x) list(Depends = x$Depends, Imports = x$Imports, LinkingTo = x$LinkingTo))
find$recommended_packages_from_R_installation <- lapply(stats::setNames(nm = c("MASS", "Matrix", "stats4", "lattice")), lic_of)
find$needs_compilation <- names(Filter(function(x) identical(x$NeedsCompilation, "yes"), desc))

write_evidence("r_environment", find, packages = c("renv", "cSEM", "seminr", "lavaan"))
