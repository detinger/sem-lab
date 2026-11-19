# Independent, from-first-principles PLS path modeling in base R.
#
# Purpose: an analytical anchor for the Phase 0 cross-checks. It shares no code
# with cSEM or seminr; when all three agree to ~1e-8 the "classic PLS Mode A"
# pathway is considered verified rather than merely executed.
#
# Algorithm (Lohmoeller 1989; Wold 1982), on the indicator correlation matrix S:
#   1. start with unit outer weights, scale so each composite has unit variance
#   2. inner estimation: proxy_j = sum_i e_ji * composite_i with e from the scheme
#        centroid : e_ji = sign(r_ji)           for adjacent i
#        factorial: e_ji = r_ji                 for adjacent i
#        path     : e_ji = OLS coefficient of composite_j on its predecessors,
#                   and r_ji for its successors
#   3. outer estimation:
#        Mode A: w_j = cov(x_j, proxy_j)                      (correlation weights)
#        Mode B: w_j = S_jj^{-1} cov(x_j, proxy_j)            (regression weights)
#   4. rescale weights to unit composite variance; stop when max|w_new - w_old| < tol
# Then: loadings = cor(x_j, composite_j); paths = OLS on composite correlations.
#
# Optional consistent PLS (Dijkstra & Henseler 2015) correction for Mode A blocks:
#   rho_A_j = (w'w)^2 * w'(S_jj - diag(S_jj))w / w'(ww' - diag(ww'))w
#   corrected construct correlation r_ij / sqrt(rho_A_i rho_A_j)
#   consistent loadings lambda_j = w_j * sqrt(rho_A_j) / (w_j'w_j)

ref_pls <- function(X, blocks, struct, scheme = c("path", "centroid", "factorial"),
                    modes = "A", tol = 1e-5, max_iter = 100L, consistent = FALSE) {
  scheme <- match.arg(scheme)
  cons <- names(blocks)
  modes <- rep_len(modes, length(cons))
  if (is.null(names(modes))) names(modes) <- cons
  ind <- unlist(blocks, use.names = FALSE)
  S <- stats::cor(as.matrix(X[, ind]))
  K <- length(cons)

  B <- matrix(0, K, K, dimnames = list(cons, cons))        # B[dependent, predictor] = 1
  for (to in names(struct)) B[to, struct[[to]]] <- 1
  adj <- (B + t(B)) > 0

  W <- matrix(0, K, length(ind), dimnames = list(cons, ind))
  for (k in cons) W[k, blocks[[k]]] <- 1
  unit_var <- function(W) {
    for (k in cons) W[k, ] <- W[k, ] / sqrt(drop(W[k, , drop = FALSE] %*% S %*% t(W[k, , drop = FALSE])))
    W
  }
  W <- unit_var(W)

  converged <- FALSE
  iter <- 0L
  repeat {
    iter <- iter + 1L
    R <- W %*% S %*% t(W)
    E <- matrix(0, K, K, dimnames = list(cons, cons))
    if (scheme == "centroid") {
      E[adj] <- sign(R)[adj]
    } else if (scheme == "factorial") {
      E[adj] <- R[adj]
    } else {
      for (j in cons) {
        pred <- cons[B[j, ] == 1]
        succ <- cons[B[, j] == 1]
        if (length(pred)) E[j, pred] <- solve(R[pred, pred, drop = FALSE], R[pred, j])
        if (length(succ)) E[j, succ] <- R[j, succ]
      }
    }
    C <- S %*% t(W) %*% t(E)                                # cov(indicator, inner proxy_j)
    Wn <- W * 0
    for (j in cons) {
      b <- blocks[[j]]
      Wn[j, b] <- if (modes[[j]] == "A") C[b, j] else solve(S[b, b, drop = FALSE], C[b, j])
    }
    Wn <- unit_var(Wn)
    delta <- max(abs(Wn - W))
    W <- Wn
    if (delta < tol) { converged <- TRUE; break }
    if (iter >= max_iter) break
  }

  R <- W %*% S %*% t(W)
  L <- W * 0
  for (j in cons) L[j, blocks[[j]]] <- drop(S[blocks[[j]], ] %*% W[j, ])

  rho_A <- stats::setNames(rep(1, K), cons)
  Rc <- R
  Lc <- L
  if (consistent) {
    for (j in cons) {
      if (modes[[j]] != "A" || length(blocks[[j]]) < 2) next
      b <- blocks[[j]]
      w <- W[j, b]
      Sjj <- S[b, b]
      ww <- tcrossprod(w)
      rho_A[j] <- sum(w^2)^2 * drop(t(w) %*% (Sjj - diag(diag(Sjj))) %*% w) /
        drop(t(w) %*% (ww - diag(diag(ww))) %*% w)
      Lc[j, b] <- w * sqrt(rho_A[j]) / sum(w^2)
    }
    Rc <- R / sqrt(tcrossprod(rho_A))
    diag(Rc) <- 1
  }

  paths <- matrix(0, K, K, dimnames = list(cons, cons))
  r2 <- numeric(0)
  for (to in names(struct)) {
    pred <- struct[[to]]
    beta <- solve(Rc[pred, pred, drop = FALSE], Rc[pred, to])
    paths[to, pred] <- beta
    r2[to] <- sum(beta * Rc[pred, to])
  }
  list(weights = W, loadings = Lc, paths = paths, r2 = r2, construct_cor = Rc,
       proxy_cor = R, rho_A = rho_A, iterations = iter, converged = converged, S = S)
}
