# cSEM estimation for classic PLS-SEM and PLSc (docs/estimators/pls-csem.md).
#
# Verified facts this file relies on (docs/validation/phase-0/r-spike.md §4):
#   - classic PLS = "=~" with .disattenuate = FALSE (a plain "=~" call is PLSc);
#   - Mode B = "<~" (.disattenuate has no effect on composites);
#   - rho_A must be taken from a PLSc fit (a classic object returns 1);
#   - cSEM orders constructs/indicators its own way: always index by name.

VERIFY_CHECKS <- c(
  "1" = "Convergence achieved",
  "2" = "All absolute standardized loading estimates <= 1",
  "3" = "Construct VCV is positive semi-definite",
  "4" = "All reliability estimates <= 1",
  "5" = "Model-implied indicator VCV is positive semi-definite"
)

#' The exact csem() options for a method. Every value is passed explicitly (all equal
#' cSEM 0.7.1 defaults except .disattenuate for classic PLS and the user's
#' scheme / iteration cap / tolerance), so the recorded call is complete.
csem_options <- function(spec, disattenuate) {
  o <- list(
    .approach_weights = "PLS-PM",
    .approach_paths = "OLS",
    .disattenuate = disattenuate,
    .PLS_weight_scheme_inner = spec$scheme,
    .iter_max = spec$max_iter,
    .tolerance = spec$tol,
    .conv_criterion = "diff_absolute"
  )
  if (disattenuate) o$.PLS_approach_cf <- "dist_squared_euclid"
  o
}

format_arg <- function(v) {
  if (is.character(v)) return(paste0("\"", v, "\""))
  if (is.logical(v)) return(if (v) "TRUE" else "FALSE")
  if (is.integer(v)) return(paste0(v, "L"))
  format(v, digits = 15)
}

#' Text of a call with aliases only, e.g. cSEM::csem(.data = data, .model = model, ...).
call_text <- function(fn, first_args, opts) {
  parts <- c(first_args, vapply(names(opts), function(n) paste0(n, " = ", format_arg(opts[[n]])), character(1)))
  paste0(fn, "(", paste(parts, collapse = ", "), ")")
}

#' Run csem() and capture warnings. Unexpected errors become ENGINE_INTERNAL with a
#' sanitized message (cSEM messages can contain row numbers).
fit_csem <- function(data, model, opts, al, stage = "estimation") {
  warns <- character(0)
  fit <- tryCatch(
    withCallingHandlers(
      do.call(cSEM::csem, c(list(.data = data, .model = model), opts)),
      warning = function(w) {
        warns <<- c(warns, conditionMessage(w))
        invokeRestart("muffleWarning")
      },
      message = function(m) invokeRestart("muffleMessage")
    ),
    error = function(e) {
      log_line("cSEM error during ", stage, ": ", sanitize_message(dealias_text(conditionMessage(e), al)))
      engine_error("ENGINE_INTERNAL", sprintf("cSEM failed during %s. See the technical log for the sanitized cSEM message.", stage),
                   list(stage = stage))
    }
  )
  warns <- unique(warns)
  clean <- vapply(dealias_text(warns, al), sanitize_message, character(1), max_chars = 500L, USE.NAMES = FALSE)
  list(fit = fit, warnings = clean)
}

convergence_of <- function(fit) {
  wi <- fit$Information$Weight_info
  list(converged = isTRUE(wi$Convergence_status), iterations = as.numeric(wi$Number_iterations))
}

#' verify() as a named logical: TRUE = the check FAILED.
verify_flags <- function(fit) {
  v <- unclass(cSEM::verify(fit))
  attributes(v) <- list(names = names(v))
  v
}

#' Main estimation: returns the fit plus the auxiliary PLSc fit used for rho_A.
estimate_pls <- function(spec, data, model, al) {
  plsc <- spec$method == "plsc"
  opts <- csem_options(spec, disattenuate = plsc)
  main <- fit_csem(data, model, opts, al, "estimation")
  conv <- convergence_of(main$fit)
  if (!conv$converged) {
    engine_error("ENGINE_NONCONVERGENCE",
                 sprintf("The PLS weight algorithm did not converge within %d iterations (tolerance %s).",
                         spec$max_iter, format(spec$tol)),
                 list(maxIterations = spec$max_iter, tolerance = spec$tol, iterations = conv$iterations))
  }
  calls <- c(sprintf("model <- \"%s\"", gsub("\n", "\\\\n", model)),
             call_text("fit <- cSEM::csem", c(".data = data", ".model = model"), opts))
  # rho_A: from a PLSc fit of the same model (identical weights; classic objects return 1)
  rho_fit <- NULL
  rho_msg <- NULL
  if (plsc) {
    rho_fit <- main$fit
  } else if (any(vapply(spec$constructs, function(cc) cc$measurement == "reflective", logical(1)))) {
    opts_c <- csem_options(spec, disattenuate = TRUE)
    aux <- tryCatch(fit_csem(data, model, opts_c, al, "rho_A auxiliary PLSc fit"), engine_error = function(e) NULL)
    if (!is.null(aux) && convergence_of(aux$fit)$converged) {
      rho_fit <- aux$fit
    } else {
      rho_msg <- "The auxiliary PLSc fit used for rho_A failed; rho_A is not reported."
    }
    calls <- c(calls, call_text("fit_rhoA <- cSEM::csem", c(".data = data", ".model = model"), opts_c))
  }
  list(fit = main$fit, opts = opts, warnings = main$warnings, converged = conv$converged,
       iterations = conv$iterations, verify = verify_flags(main$fit),
       rho_fit = rho_fit, rho_msg = rho_msg, calls = calls)
}
