# Request and data validation (defence in depth: the web app and the API validate too).
#
# validate_request() turns request.json into a normalised `spec` or raises a stable
# engine error. load_job_data() reads data.csv and returns the numeric indicator
# matrix in model order. Neither ever puts a data value into a message.

ID_PATTERN <- "^[A-Za-z0-9_][A-Za-z0-9_.:-]*$"
PROTOCOL_VERSION <- 1L
DEFAULT_CHUNK_SIZE <- 100L
MAX_SPECIFIC_INDIRECT <- 500L

invalid <- function(msg, details = list()) engine_error("REQUEST_INVALID", msg, details)

is_scalar_string <- function(x) is.character(x) && length(x) == 1L && !is.na(x)
is_scalar_number <- function(x) is.numeric(x) && length(x) == 1L && is.finite(x)
is_scalar_bool <- function(x) is.logical(x) && length(x) == 1L && !is.na(x)
is_whole <- function(x) is_scalar_number(x) && abs(x - round(x)) < 1e-9

check_id <- function(x, what) {
  if (!is_scalar_string(x) || nchar(x) > 128L || !grepl(ID_PATTERN, x)) {
    invalid(sprintf("%s must be an id matching %s (max 128 characters).", what, ID_PATTERN))
  }
  x
}

#' Parse and validate request.json. Returns the normalised spec.
validate_request <- function(req, caps) {
  if (!is.list(req)) invalid("request.json must contain a JSON object.")
  if (!is_scalar_number(req$protocolVersion) || req$protocolVersion != PROTOCOL_VERSION) {
    invalid(sprintf("Unsupported protocolVersion; this engine implements protocol %d.", PROTOCOL_VERSION))
  }
  model <- req$model
  an <- req$analysis
  if (!is.list(model) || !is.list(an)) invalid("request.json needs `model` and `analysis` objects.")

  # ---- analysis -------------------------------------------------------------------
  if (!identical(an$engine, ENGINE_ID)) {
    invalid(sprintf("This is the %s engine; the request asks for engine `%s`.", ENGINE_ID,
                    if (is_scalar_string(an$engine)) an$engine else "?"))
  }
  method <- an$method
  if (!is_scalar_string(method)) invalid("analysis.method is required.")
  if (method == "cb-sem") {
    engine_error("CAPABILITY_UNSUPPORTED", "CB-SEM is not estimated by the r-csem engine.",
                 list(method = method, engine = ENGINE_ID))
  }
  if (!method %in% c("pls-sem", "plsc")) invalid("analysis.method must be `pls-sem` or `plsc`.")
  require_capability(caps, if (method == "pls-sem") "pls.estimation.classic" else "pls.estimation.plsc",
                     if (method == "pls-sem") "Classic PLS-SEM" else "Consistent PLS (PLSc)")
  if (!identical(an$estimator, "pls-pm")) {
    engine_error("CAPABILITY_UNSUPPORTED", "The r-csem engine implements estimator `pls-pm` only.",
                 list(engine = ENGINE_ID))
  }
  if (!identical(an$missingData, "listwise")) {
    invalid("analysis.missingData must be `listwise` for PLS methods (FIML is defined for CB-SEM only).")
  }
  if (!is.null(an$cb)) invalid("analysis.cb is only valid for CB-SEM.")
  if (!is.null(an$ipma)) require_capability(caps, "ipma.construct", "Importance-performance map analysis")

  pls <- an$pls
  if (!is.list(pls)) invalid("analysis.pls (innerWeighting, maxIterations, tolerance) is required for PLS methods.")
  scheme <- pls$innerWeighting
  if (!is_scalar_string(scheme) || !scheme %in% c("path", "centroid", "factorial")) {
    invalid("analysis.pls.innerWeighting must be `path`, `centroid` or `factorial`.")
  }
  require_capability(caps, paste0("pls.inner-weighting.", scheme), sprintf("Inner weighting scheme `%s`", scheme))
  if (!is_whole(pls$maxIterations) || pls$maxIterations < 1 || pls$maxIterations > 100000) {
    invalid("analysis.pls.maxIterations must be an integer in [1, 100000].")
  }
  if (!is_scalar_number(pls$tolerance) || pls$tolerance <= 0 || pls$tolerance > 0.01) {
    invalid("analysis.pls.tolerance must be a number in (0, 0.01].")
  }

  # ---- limits -----------------------------------------------------------------------
  limits <- req$limits
  if (is.null(limits)) limits <- list()
  max_boot <- if (is.null(limits$maxBootstrap)) 100000 else limits$maxBootstrap
  timeout <- if (is.null(limits$timeoutSeconds)) Inf else limits$timeoutSeconds
  chunk_size <- if (is.null(limits$chunkSize)) DEFAULT_CHUNK_SIZE else limits$chunkSize
  if (!is_whole(max_boot) || max_boot < 0) invalid("limits.maxBootstrap must be a non-negative integer.")
  if (!(is.numeric(timeout) && length(timeout) == 1L && !is.na(timeout) && timeout > 0)) {
    invalid("limits.timeoutSeconds must be a positive number.")
  }
  if (!is_whole(chunk_size) || chunk_size < 1 || chunk_size > 100000) {
    invalid("limits.chunkSize must be an integer in [1, 100000].")
  }

  # ---- bootstrap --------------------------------------------------------------------
  boot <- NULL
  if (!is.null(an$bootstrap) && isTRUE(an$bootstrap$enabled)) {
    b <- an$bootstrap
    if (!is_scalar_string(b$ci) || !b$ci %in% c("percentile", "bca")) invalid("analysis.bootstrap.ci must be `percentile` or `bca`.")
    require_capability(caps, paste0("resampling.bootstrap-", b$ci), sprintf("Bootstrap `%s` intervals", b$ci))
    if (!is_whole(b$repetitions) || b$repetitions < 1 || b$repetitions > 100000) {
      invalid("analysis.bootstrap.repetitions must be an integer in [1, 100000].")
    }
    if (b$repetitions > max_boot) {
      invalid(sprintf("analysis.bootstrap.repetitions exceeds limits.maxBootstrap (%d).", as.integer(max_boot)))
    }
    if (!is_scalar_number(b$confidenceLevel) || b$confidenceLevel <= 0.5 || b$confidenceLevel >= 1) {
      invalid("analysis.bootstrap.confidenceLevel must lie strictly between 0.5 and 1.")
    }
    if (!is_scalar_string(b$sides) || !b$sides %in% c("two-sided", "one-sided")) {
      invalid("analysis.bootstrap.sides must be `two-sided` or `one-sided`.")
    }
    if (!is_whole(an$seed) || an$seed < 0 || an$seed > 2147483647) {
      invalid("analysis.seed (integer in [0, 2147483647]) is required when bootstrapping.")
    }
    boot <- list(reps = as.integer(b$repetitions), level = b$confidenceLevel, sides = b$sides,
                 seed = as.numeric(an$seed), ci = b$ci)
  } else if (!is.null(an$bootstrap) && !is_scalar_bool(an$bootstrap$enabled)) {
    invalid("analysis.bootstrap.enabled must be true or false.")
  }

  # ---- model ------------------------------------------------------------------------
  cons_in <- model$constructs
  inds_in <- model$indicators
  rels_in <- if (is.null(model$relationships)) list() else model$relationships
  if (!is.list(cons_in) || !length(cons_in)) invalid("model.constructs must be a non-empty array.")
  if (!is.list(inds_in)) invalid("model.indicators must be an array.")
  if (!is.list(rels_in)) invalid("model.relationships must be an array.")

  indicators <- list()
  for (i in inds_in) {
    id <- check_id(i$id, "indicator id")
    if (!is.null(indicators[[id]])) invalid(sprintf("Duplicate indicator id `%s`.", id))
    col <- i$column
    if (!is.null(col) && !is_scalar_string(col)) invalid(sprintf("Indicator `%s`: column must be a string or null.", id))
    rev <- isTRUE(i$reverseScored)
    smin <- NA_real_; smax <- NA_real_
    if (!is.null(i$scale)) {
      if (!is_scalar_number(i$scale$min) || !is_scalar_number(i$scale$max) || i$scale$min >= i$scale$max) {
        invalid(sprintf("Indicator `%s`: scale needs numeric min < max.", id))
      }
      smin <- i$scale$min; smax <- i$scale$max
    }
    indicators[[id]] <- list(id = id, column = col, reverse = rev, scale_min = smin, scale_max = smax)
  }

  constructs <- list()
  used_inds <- character(0)
  warnings <- list()
  for (cc in cons_in) {
    id <- check_id(cc$id, "construct id")
    if (!is.null(constructs[[id]]) || !is.null(indicators[[id]])) invalid(sprintf("Duplicate id `%s`.", id))
    if (!is_scalar_string(cc$measurement) || !cc$measurement %in% c("reflective", "composite-formative")) {
      invalid(sprintf("Construct `%s`: measurement must be `reflective` or `composite-formative`.", id))
    }
    if (!is.null(cc$higherOrder)) require_capability(caps, "pls.higher-order", "Higher-order constructs")
    ind_ids <- unlist(cc$indicatorIds)
    if (!length(ind_ids)) invalid(sprintf("Construct `%s` has no indicators.", id), list(constructId = id))
    for (ii in ind_ids) {
      if (is.null(indicators[[ii]])) invalid(sprintf("Construct `%s` lists unknown indicator `%s`.", id, ii))
    }
    if (anyDuplicated(ind_ids)) invalid(sprintf("Construct `%s` lists an indicator twice.", id))
    dup <- intersect(ind_ids, used_inds)
    if (length(dup)) {
      invalid(sprintf("Indicator `%s` is assigned to more than one construct.", dup[1]), list(indicatorIds = I(dup)))
    }
    used_inds <- c(used_inds, ind_ids)
    default_mode <- if (cc$measurement == "reflective") "mode-a" else "mode-b"
    mode <- if (is.null(cc$plsWeightingMode)) default_mode else cc$plsWeightingMode
    if (!mode %in% c("mode-a", "mode-b")) invalid(sprintf("Construct `%s`: plsWeightingMode must be `mode-a` or `mode-b`.", id))
    if (mode != default_mode) {
      engine_error("CAPABILITY_UNSUPPORTED",
                   sprintf("Construct `%s`: overriding the weighting mode of a %s block (%s) is not offered by the r-csem engine; the mode follows the measurement kind.",
                           id, cc$measurement, mode),
                   list(constructId = id))
    }
    if (cc$measurement == "composite-formative") require_capability(caps, "pls.mode-b", "Mode B (composite/formative) blocks")
    constructs[[id]] <- list(id = id, measurement = cc$measurement, mode = if (mode == "mode-a") "A" else "B",
                             indicator_ids = ind_ids)
  }
  cons_ids <- names(constructs)

  for (ii in used_inds) {
    ind <- indicators[[ii]]
    if (is.null(ind$column)) {
      invalid(sprintf("Indicator `%s` is not mapped to a data column.", ii), list(indicatorIds = I(ii)))
    }
    if (ind$reverse && (is.na(ind$scale_min) || is.na(ind$scale_max))) {
      invalid(sprintf("Indicator `%s` is reverse scored but has no scale endpoints.", ii), list(indicatorIds = I(ii)))
    }
  }
  cols <- vapply(used_inds, function(ii) indicators[[ii]]$column, character(1))
  if (anyDuplicated(cols)) {
    dupc <- unique(cols[duplicated(cols)])
    invalid("A data column is bound to more than one indicator.", list(columns = I(dupc)))
  }

  # ---- relationships ----------------------------------------------------------------
  rel_ids <- character(0)
  p_id <- character(0); p_src <- character(0); p_tgt <- character(0)
  for (r in rels_in) {
    rid <- check_id(r$id, "relationship id")
    if (rid %in% rel_ids) invalid(sprintf("Duplicate relationship id `%s`.", rid))
    rel_ids <- c(rel_ids, rid)
    if (!is_scalar_string(r$kind) || !r$kind %in% c("structural", "covariance")) {
      invalid(sprintf("Relationship `%s`: kind must be `structural` or `covariance`.", rid))
    }
    s <- r$sourceId; t <- r$targetId
    if (!is_scalar_string(s) || !is_scalar_string(t)) invalid(sprintf("Relationship `%s` needs sourceId and targetId.", rid))
    if (r$kind == "structural") {
      if (!s %in% cons_ids || !t %in% cons_ids) invalid(sprintf("Structural relationship `%s` must connect two constructs.", rid))
      if (s == t) invalid(sprintf("Structural relationship `%s` is a self-loop.", rid))
      if (any(p_src == s & p_tgt == t)) invalid(sprintf("Structural path %s -> %s is listed twice.", s, t))
      if (!is.null(r$fixedValue)) {
        engine_error("CAPABILITY_UNSUPPORTED", sprintf("Relationship `%s`: fixed path values are not supported in PLS-SEM.", rid),
                     list(relationshipId = rid))
      }
      p_id <- c(p_id, rid); p_src <- c(p_src, s); p_tgt <- c(p_tgt, t)
    }
  }
  # covariances: only between exogenous constructs (implied and free in PLS)
  for (r in rels_in) {
    if (r$kind != "covariance") next
    s <- r$sourceId; t <- r$targetId
    if (s %in% cons_ids && t %in% cons_ids && s != t && !(s %in% p_tgt) && !(t %in% p_tgt)) {
      warnings[[length(warnings) + 1L]] <- list(
        code = "EXOGENOUS_CORRELATION_IMPLIED", severity = "info",
        message = "PLS-SEM leaves the correlation between exogenous constructs free; this covariance relationship is not a separate parameter. The estimate is in the construct-correlations matrix.",
        elementIds = I(c(r$id, s, t)))
    } else {
      engine_error("CAPABILITY_UNSUPPORTED",
                   sprintf("Covariance relationship `%s`: PLS-SEM in r-csem does not estimate indicator residual covariances or covariances involving endogenous constructs.", r$id),
                   list(relationshipId = r$id))
    }
  }

  if (!length(p_id)) {
    engine_error("MODEL_NOT_IDENTIFIED", "A PLS path model needs at least one structural path.", list())
  }
  isolated <- setdiff(cons_ids, c(p_src, p_tgt))
  if (length(isolated)) {
    engine_error("MODEL_NOT_IDENTIFIED",
                 "Every construct must take part in at least one structural path (the PLS inner weighting has no neighbour for an isolated construct).",
                 list(constructIds = I(isolated)))
  }
  cyc <- find_cycle(cons_ids, p_src, p_tgt)
  if (!is.null(cyc)) {
    invalid(sprintf("The structural model contains a cycle (%s). The r-csem PLS engine estimates recursive models only.",
                    paste(cyc, collapse = " -> ")), list(constructIds = I(unique(cyc))))
  }

  list(
    method = method, scheme = scheme, max_iter = as.integer(pls$maxIterations), tol = pls$tolerance,
    constructs = constructs, indicators = indicators[used_inds], indicator_ids = used_inds,
    paths = data.frame(id = p_id, source = p_src, target = p_tgt, stringsAsFactors = FALSE),
    bootstrap = boot,
    limits = list(max_bootstrap = max_boot, timeout = timeout, chunk_size = as.integer(chunk_size)),
    warnings = warnings
  )
}

NUMBER_RE <- "^[[:space:]]*[-+]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][-+]?[0-9]+)?[[:space:]]*$"

#' Read data.csv and return list(X = numeric matrix [n x p] in model indicator order,
#' columns named by indicator id, n_rows). Applies reverse scoring.
load_job_data <- function(path, spec) {
  if (!file.exists(path)) invalid("data.csv is missing from the job directory.")
  raw <- tryCatch(
    utils::read.csv(path, header = TRUE, sep = ",", quote = "\"", colClasses = "character",
                    na.strings = character(0), check.names = FALSE, fileEncoding = "UTF-8-BOM",
                    strip.white = FALSE, comment.char = "", blank.lines.skip = TRUE),
    error = function(e) invalid("data.csv could not be parsed as a comma-separated file with a header row.")
  )
  n_rows <- nrow(raw)
  hdr <- names(raw)
  cols <- vapply(spec$indicator_ids, function(ii) spec$indicators[[ii]]$column, character(1))
  missing_cols <- cols[!cols %in% hdr]
  if (length(missing_cols)) {
    engine_error("DATA_COLUMN_MISSING",
                 sprintf("%d mapped column(s) are not in data.csv: %s.", length(missing_cols),
                         paste(sprintf("`%s`", missing_cols), collapse = ", ")),
                 list(columns = I(unname(missing_cols)), indicatorIds = I(names(missing_cols))))
  }
  ambiguous <- cols[cols %in% hdr[duplicated(hdr)]]
  if (length(ambiguous)) {
    invalid("A mapped column name occurs more than once in the data.csv header.", list(columns = I(unname(ambiguous))))
  }
  X <- matrix(NA_real_, n_rows, length(cols), dimnames = list(NULL, spec$indicator_ids))
  not_numeric <- character(0); n_bad <- integer(0)
  has_missing <- character(0); n_missing <- integer(0)
  for (j in seq_along(cols)) {
    v <- raw[[cols[j]]]
    empty <- is.na(v) | !nzchar(trimws(v))
    ok <- grepl(NUMBER_RE, v) & !empty
    bad <- !ok & !empty
    if (any(bad)) { not_numeric <- c(not_numeric, cols[j]); n_bad <- c(n_bad, sum(bad)) }
    if (any(empty)) { has_missing <- c(has_missing, cols[j]); n_missing <- c(n_missing, sum(empty)) }
    x <- rep(NA_real_, n_rows)
    x[ok] <- as.numeric(v[ok])
    X[, j] <- x
  }
  if (length(not_numeric)) {
    engine_error("DATA_NOT_NUMERIC",
                 sprintf("%d mapped column(s) contain non-numeric cells: %s.", length(not_numeric),
                         paste(sprintf("`%s` (%d cells)", not_numeric, n_bad), collapse = ", ")),
                 list(columns = I(not_numeric), nonNumericCells = I(n_bad)))
  }
  if (length(has_missing)) {
    invalid(sprintf("%d mapped column(s) contain empty (missing) cells: %s. The engine expects the listwise-complete data set.",
                    length(has_missing), paste(sprintf("`%s` (%d cells)", has_missing, n_missing), collapse = ", ")),
            list(reason = "missing-values", columns = I(has_missing), missingCells = I(n_missing)))
  }
  if (any(!is.finite(X))) invalid("data.csv contains non-finite numbers in mapped columns.")
  if (n_rows < 3L) {
    engine_error("DATA_INSUFFICIENT_ROWS", sprintf("data.csv has %d row(s); at least 3 are required.", n_rows),
                 list(nRows = n_rows, minimum = 3L))
  }
  const <- cols[apply(X, 2L, function(x) all(x == x[1L]))]
  if (length(const)) {
    engine_error("DATA_ZERO_VARIANCE",
                 sprintf("%d mapped column(s) have zero variance: %s.", length(const), paste(sprintf("`%s`", const), collapse = ", ")),
                 list(columns = I(unname(const)), indicatorIds = I(names(const))))
  }
  # reverse scoring: x' = (min + max) - x on the declared scale endpoints
  reversed <- character(0)
  for (ii in spec$indicator_ids) {
    ind <- spec$indicators[[ii]]
    if (ind$reverse) {
      X[, ii] <- (ind$scale_min + ind$scale_max) - X[, ii]
      reversed <- c(reversed, ii)
    }
  }
  # Mode B blocks need a non-singular indicator correlation matrix
  for (cc in spec$constructs) {
    if (cc$mode != "B" || length(cc$indicator_ids) < 2L) next
    R <- stats::cor(X[, cc$indicator_ids, drop = FALSE])
    if (qr(R, tol = 1e-10)$rank < ncol(R)) {
      engine_error("MODEL_NOT_IDENTIFIED",
                   sprintf("The indicators of Mode B construct `%s` are perfectly collinear; its weights are not identified.", cc$id),
                   list(constructId = cc$id))
    }
  }
  list(X = X, n_rows = n_rows, reversed = reversed)
}
