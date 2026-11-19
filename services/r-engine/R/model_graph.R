# Structural-model graph helpers. Nodes are construct ids; edges are structural paths
# source -> target. Pure functions, no cSEM.

#' Find one directed cycle; returns the node ids on it, or NULL when the graph is acyclic.
find_cycle <- function(nodes, from, to) {
  adj <- split(to, factor(from, levels = nodes))
  state <- stats::setNames(integer(length(nodes)), nodes)   # 0 new, 1 on stack, 2 done
  stack <- character(0)
  found <- NULL
  visit <- function(v) {
    state[[v]] <<- 1L
    stack <<- c(stack, v)
    for (w in adj[[v]]) {
      if (!is.null(found)) return(invisible())
      if (state[[w]] == 1L) {
        found <<- c(stack[seq.int(match(w, stack), length(stack))], w)
        return(invisible())
      }
      if (state[[w]] == 0L) visit(w)
    }
    stack <<- stack[-length(stack)]
    state[[v]] <<- 2L
  }
  for (v in nodes) if (is.null(found) && state[[v]] == 0L) visit(v)
  found
}

#' All directed paths (as node vectors, source first) from `src` to `tgt` in a DAG.
all_paths <- function(nodes, from, to, src, tgt, limit = Inf) {
  adj <- split(to, factor(from, levels = nodes))
  out <- list()
  walk <- function(v, trail) {
    if (length(out) >= limit) return(invisible())
    for (w in adj[[v]]) {
      if (w == tgt) out[[length(out) + 1L]] <<- c(trail, w)
      else walk(w, c(trail, w))
    }
  }
  walk(src, src)
  out
}

#' Every ordered pair (src, tgt) with at least one directed path, with the list of
#' paths and whether a direct edge exists. Pairs appear in model construct order.
#' `max_specific` caps the number of enumerated paths of length >= 2 in total.
connected_pairs <- function(nodes, from, to, max_specific = 500L) {
  pairs <- list()
  n_specific <- 0L
  truncated <- FALSE
  for (s in nodes) for (t in nodes) {
    if (s == t) next
    ps <- all_paths(nodes, from, to, s, t)
    if (!length(ps)) next
    long <- Filter(function(p) length(p) >= 3L, ps)
    if (n_specific + length(long) > max_specific) {
      keep <- max(0L, max_specific - n_specific)
      truncated <- truncated || keep < length(long)
      long <- long[seq_len(keep)]
    }
    n_specific <- n_specific + length(long)
    pairs[[length(pairs) + 1L]] <- list(
      source = s, target = t,
      direct = any(from == s & to == t),
      has_indirect = any(vapply(ps, length, integer(1)) >= 3L),
      specific = long
    )
  }
  list(pairs = pairs, truncated = truncated)
}
