# Capability registry gate (packages/method-registry/registry.json).
#
# The engine refuses every requested capability whose status for engine "r-csem" is
# not "supported" or "beta" with CAPABILITY_UNSUPPORTED, quoting the registry reason.

ENGINE_ID <- "r-csem"

registry_path <- function() {
  p <- Sys.getenv("SEM_STUDIO_REGISTRY", "")
  if (nzchar(p)) return(p)
  engine_dir <- Sys.getenv("SEM_STUDIO_R_ENGINE_DIR", "")
  if (!nzchar(engine_dir)) engine_dir <- ENGINE_DIR
  file.path(engine_dir, "..", "..", "packages", "method-registry", "registry.json")
}

load_registry <- function(path = registry_path()) {
  if (!file.exists(path)) {
    engine_error("ENGINE_INTERNAL", "The capability registry could not be found by the R engine.")
  }
  reg <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  caps <- reg$capabilities
  names(caps) <- vapply(caps, function(c) c$id, character(1))
  caps
}

capability_entry <- function(caps, cap_id, engine = ENGINE_ID) {
  cap <- caps[[cap_id]]
  if (is.null(cap)) return(NULL)
  cap$engines[[engine]]
}

#' Stop with CAPABILITY_UNSUPPORTED unless `cap_id` is supported/beta for the engine.
require_capability <- function(caps, cap_id, what, engine = ENGINE_ID) {
  e <- capability_entry(caps, cap_id, engine)
  status <- if (is.null(e)) "absent" else e$status
  if (!status %in% c("supported", "beta")) {
    reason <- if (!is.null(e$reason)) e$reason else "not offered for this engine"
    engine_error(
      "CAPABILITY_UNSUPPORTED",
      sprintf("%s is not available in engine %s (registry status: %s). %s", what, engine, status, reason),
      list(capabilityId = cap_id, status = status, engine = engine)
    )
  }
  invisible(status)
}
