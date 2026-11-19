# Safe syntax by construction.
#
# Constructs are renamed C1..Ck and indicators X1..Xp in model order (constructs in
# `model.constructs` order; indicators block by block in `indicatorIds` order) before
# any cSEM syntax is written. User text (names, labels, column names, ids) never
# enters R code or cSEM syntax: the syntax is assembled only from the aliases, the
# fixed operators "=~", "<~", "~", " + " and newlines.

build_aliases <- function(spec) {
  cons_ids <- names(spec$constructs)
  c_alias <- stats::setNames(paste0("C", seq_along(cons_ids)), cons_ids)
  x_alias <- stats::setNames(paste0("X", seq_along(spec$indicator_ids)), spec$indicator_ids)
  list(
    construct = c_alias,                                   # id -> alias
    indicator = x_alias,
    construct_id = stats::setNames(names(c_alias), c_alias),  # alias -> id
    indicator_id = stats::setNames(names(x_alias), x_alias)
  )
}

ALIAS_RE <- "^[CX][1-9][0-9]*$"

#' cSEM model syntax over aliases. Reflective -> "=~", composite-formative -> "<~".
build_csem_model <- function(spec, al) {
  meas <- vapply(spec$constructs, function(cc) {
    op <- if (cc$measurement == "reflective") "=~" else "<~"
    paste(al$construct[[cc$id]], op, paste(al$indicator[cc$indicator_ids], collapse = " + "))
  }, character(1))
  targets <- unique(spec$paths$target)
  targets <- names(spec$constructs)[names(spec$constructs) %in% targets]
  struct <- vapply(targets, function(t) {
    srcs <- spec$paths$source[spec$paths$target == t]
    paste(al$construct[[t]], "~", paste(al$construct[srcs], collapse = " + "))
  }, character(1))
  tokens <- c(unname(al$construct), unname(al$indicator))
  stopifnot(all(grepl(ALIAS_RE, tokens)))
  txt <- paste(c(unname(meas), unname(struct)), collapse = "\n")
  # defence: the syntax may contain only aliases, operators, spaces and newlines
  stopifnot(grepl("^[CX0-9 =~<+\n]+$", txt))
  txt
}

#' Data frame for cSEM: columns named X1..Xp (aliases), numeric.
alias_data <- function(X, al) {
  d <- as.data.frame(X, stringsAsFactors = FALSE)
  names(d) <- unname(al$indicator[colnames(X)])
  d
}

#' Replace alias tokens in a cSEM message by model ids (ids are safe opaque strings).
dealias_text <- function(txt, al) {
  m <- c(al$construct_id, al$indicator_id)
  out <- as.character(txt)
  for (i in seq_along(out)) {
    g <- gregexpr("\\b[CX][1-9][0-9]*\\b", out[i], perl = TRUE)
    toks <- regmatches(out[i], g)[[1]]
    if (!length(toks)) next
    repl <- ifelse(is.na(m[toks]), toks, unname(m[toks]))
    s <- out[i]
    regmatches(s, g) <- list(repl)   # single pass: replaced ids are never re-scanned
    out[i] <- s
  }
  out
}
