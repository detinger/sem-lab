# Entry point of the SEM Studio R engine.
#
#   services/r-engine/bin/run-job <job-dir>
#
# (bin/run-job execs bin/rscript on this file.) Exit status 0 means result.json was
# written (ok:true, or ok:false with a stable error code); anything else is a crash.

local({
  args <- commandArgs(trailingOnly = FALSE)
  f <- sub("^--file=", "", args[grepl("^--file=", args)][1])
  if (is.na(f)) stop("main.R must be run with Rscript")
  r_dir <- dirname(normalizePath(f, mustWork = TRUE))
  assign("ENGINE_DIR", normalizePath(file.path(r_dir, ".."), mustWork = TRUE), envir = globalenv())
  for (src in c("job_errors.R", "job_io.R", "registry.R", "model_graph.R", "job_validate.R",
                "pls_alias.R", "pls_estimate.R", "pls_results.R", "pls_bootstrap.R", "run_job.R")) {
    sys.source(file.path(r_dir, src), envir = globalenv())
  }
})

main <- function() {
  a <- commandArgs(trailingOnly = TRUE)
  if (length(a) != 1L || !dir.exists(a[1])) {
    cat("usage: run-job <job-dir>\n", file = stderr())
    return(2L)
  }
  suppressPackageStartupMessages(library(jsonlite))
  run_job(normalizePath(a[1], mustWork = TRUE))
}

quit(save = "no", status = main())
