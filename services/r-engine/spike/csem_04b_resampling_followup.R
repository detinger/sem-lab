# Phase 0 spike - cSEM resampling follow-up (questions left open by csem_04_resampling.R).
#
#   1. .dominant_indicators: correct argument type and effect on draws
#   2. CI_basic: what formula infer() actually uses (default .bias_corrected = TRUE)
#   3. a replication that raises an ERROR on an otherwise healthy data set
#   4. .handle_inadmissibles = "replace": are the replacement draws the draws of seed + 1?
#   5. sign_change_option = "individual": draws silently lost vs Number_of_admissibles
#
# Evidence: docs/validation/phase-0/evidence/r/csem_resampling_followup.json

source(file.path(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "_common.R"))
suppressPackageStartupMessages(library(cSEM))

d <- load_tam()
n <- nrow(d)
m_cf <- tam_model_syntax("=~")
find <- list()
draws_of <- function(res, what = "Path_estimates") res$Estimates$Estimates_resample$Estimates1[[what]]$Resampled
info_of <- function(res) res$Information$Information_resample
flip_count <- function(v) {
  e <- v$Estimates$Estimates_resample$Estimates1$Weight_estimates
  sum(apply(sign(e$Resampled), 1, function(r) any(r != sign(e$Original))))
}

# ---- 1. .dominant_indicators ---------------------------------------------------------------
set.seed(12)
weak <- d[sample.int(n, 40), ]
weak$USE3 <- sample(1:7, 40, replace = TRUE); weak$USE4 <- sample(1:7, 40, replace = TRUE)
base_weak <- csem(weak, m_cf, .disattenuate = FALSE)
dom_vec <- c(PEOU = "EOU1", PU = "USEF1", ATU = "ATT1", BI = "BI1", USE = "USE1")
as_list <- try_capture(csem(weak, m_cf, .disattenuate = FALSE, .dominant_indicators = as.list(dom_vec)))
as_vec <- try_capture(csem(weak, m_cf, .disattenuate = FALSE, .dominant_indicators = dom_vec))
noise_dom <- try_capture(csem(weak, m_cf, .disattenuate = FALSE, .dominant_indicators = c(USE = "USE3")))
nodom_boot <- csem(weak, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 100, .seed = 9, .handle_inadmissibles = "ignore")
dom_boot <- try_capture(csem(weak, m_cf, .disattenuate = FALSE, .dominant_indicators = dom_vec, .resample_method = "bootstrap",
                             .R = 100, .seed = 9, .handle_inadmissibles = "ignore"))
dom_cols <- paste0(names(dom_vec), " =~ ", dom_vec)
neg_dom <- function(v) { L <- draws_of(v, "Loading_estimates"); sum(L[, intersect(dom_cols, colnames(L)), drop = FALSE] < 0) }
find$dominant_indicators <- list(
  setup = "same weak-block subsample as csem_resampling.json sign_change_option (n = 40, USE3/USE4 noise)",
  named_list = status_of(as_list),
  named_character_vector = status_of(as_vec, function(v) list(
    max_abs_diff_paths_vs_no_dominant = max_abs_diff(csem_paths_df(v)$est, csem_paths_df(base_weak)$est))),
  noise_indicator_as_dominant = status_of(noise_dom, function(v) list(
    loadings_USE = vec_named(v$Estimates$Loading_estimates["USE", TAM_BLOCKS$USE]),
    loadings_USE_without = vec_named(base_weak$Estimates$Loading_estimates["USE", TAM_BLOCKS$USE]),
    path_USE_BI = v$Estimates$Path_estimates["USE", "BI"],
    path_USE_BI_without = base_weak$Estimates$Path_estimates["USE", "BI"])),
  bootstrap_without = list(draws = nrow(draws_of(nodom_boot)), negative_dominant_loading_cells = neg_dom(nodom_boot),
                           draws_with_any_weight_sign_flip = flip_count(nodom_boot)),
  bootstrap_with = status_of(dom_boot, function(v) list(draws = nrow(draws_of(v)), negative_dominant_loading_cells = neg_dom(v),
                                                        draws_with_any_weight_sign_flip = flip_count(v),
                                                        sd_USE_BI_with = stats::sd(draws_of(v)[, "USE ~ BI"]),
                                                        sd_USE_BI_without = stats::sd(draws_of(nodom_boot)[, "USE ~ BI"])))
)

# construct-level sign: reverse-code every ATU item (8 - x). PLS can return the ATU construct with
# all-negative loadings; .dominant_indicators fixes the orientation.
drev <- d; for (v in TAM_BLOCKS$ATU) drev[[v]] <- 8 - drev[[v]]
rev_plain <- csem(drev, m_cf, .disattenuate = FALSE)
rev_dom <- try_capture(csem(drev, m_cf, .disattenuate = FALSE, .dominant_indicators = c(ATU = "ATT1")))
rev_boot_plain <- csem(drev, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 30, .seed = 4)
rev_boot_dom <- try_capture(csem(drev, m_cf, .disattenuate = FALSE, .dominant_indicators = c(ATU = "ATT1"),
                                 .resample_method = "bootstrap", .R = 30, .seed = 4))
find$dominant_indicators$reverse_coded_ATU_block <- list(
  setup = "all five ATT items reverse-coded as 8 - x on full tam-v1",
  without = list(loadings_ATU = vec_named(rev_plain$Estimates$Loading_estimates["ATU", TAM_BLOCKS$ATU]),
                 paths = csem_paths_df(rev_plain)),
  with_dominant_ATT1 = status_of(rev_dom, function(v) list(loadings_ATU = vec_named(v$Estimates$Loading_estimates["ATU", TAM_BLOCKS$ATU]),
                                                           paths = csem_paths_df(v),
                                                           max_abs_diff_abs_paths_vs_original_data = max_abs_diff(abs(csem_paths_df(v)$est),
                                                             abs(csem_paths_df(csem(d, m_cf, .disattenuate = FALSE))$est)))),
  bootstrap_without_ATU_loading_signs = table(sign(draws_of(rev_boot_plain, "Loading_estimates")[, "ATU =~ ATT1"])),
  bootstrap_with_ATU_loading_signs = if (rev_dom$ok && rev_boot_dom$ok) table(sign(draws_of(rev_boot_dom$value, "Loading_estimates")[, "ATU =~ ATT1"])) else rev_boot_dom$error
)

# ---- 2. CI_basic formula ------------------------------------------------------------------------
b <- csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 200, .seed = 101)
P <- draws_of(b); th <- b$Estimates$Estimates_resample$Estimates1$Path_estimates$Original
q <- apply(P, 2, stats::quantile, c(0.025, 0.975), type = 7, names = FALSE)
basic_textbook <- rbind(2 * th - q[2, ], 2 * th - q[1, ])
th_star <- 2 * th - colMeans(P)
basic_bc <- rbind(2 * th_star - q[2, ], 2 * th_star - q[1, ])
i_def <- infer(b, .quantity = "CI_basic")$Path_estimates$CI_basic
i_nobc <- infer(b, .quantity = "CI_basic", .bias_corrected = FALSE)$Path_estimates$CI_basic
find$CI_basic <- list(
  default_bias_corrected_TRUE_vs_textbook_basic = max(abs(i_def - basic_textbook)),
  default_vs_2_theta_star_minus_q_with_theta_star_2theta_minus_mean = max(abs(i_def - basic_bc)),
  bias_corrected_FALSE_vs_textbook_basic = max(abs(i_nobc - basic_textbook)),
  conclusion = "infer(.quantity = 'CI_basic') with the default .bias_corrected = TRUE is NOT the textbook basic interval; pass .bias_corrected = FALSE for 2*theta - q(1-a/2), 2*theta - q(a/2)."
)

# ---- 3. a replication that throws an error ------------------------------------------------------------
# USE1 is constant except in ONE row: about (1 - 1/n)^n = 37% of bootstrap samples miss that row and
# have a zero-variance indicator, while the original data are fine.
de <- d; de$USE1 <- 4; de$USE1[17] <- 5
orig_ok <- try_capture(csem(de, m_cf, .disattenuate = FALSE))
err <- lapply(stats::setNames(nm = c("drop", "ignore", "replace")), function(h)
  try_capture(csem(de, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 20, .seed = 1, .handle_inadmissibles = h)))
find$replication_error <- list(
  setup = "full tam-v1 with USE1 constant except row 17; ~37% of resamples have a zero-variance indicator",
  original_fit = status_of(orig_ok, function(v) list(verify = as.list(unlist(verify(v))))),
  by_handle_inadmissibles = lapply(err, function(tc) status_of(tc, function(v) list(admissible = info_of(v)$Number_of_admissibles, draws = nrow(draws_of(v))))),
  conclusion = "an error inside one replication aborts the whole resampling call (no per-replication tryCatch in resamplecSEMResultsCore); .handle_inadmissibles only governs verify() failures"
)

# ---- 4. 'replace' draws vs seed + 1 ---------------------------------------------------------------------
# find a configuration with some (not all) inadmissible PLSc replications and no errors
cand <- NULL
for (nn in c(25, 30, 35, 40, 50, 60, 80)) for (s in 1:4) {
  set.seed(1000 + s); sub <- d[sample.int(n, nn), ]
  tc <- try_capture(csem(sub, m_cf, .resample_method = "bootstrap", .R = 40, .seed = 3, .handle_inadmissibles = "drop"))
  if (tc$ok) { a <- info_of(tc$value)$Number_of_admissibles; if (a < 38 && a > 15) { cand <- list(nn = nn, s = s, sub = sub, admissible = a); break } }
  if (!is.null(cand)) break
}
if (!is.null(cand)) {
  R <- 40L
  rep_run <- csem(cand$sub, m_cf, .resample_method = "bootstrap", .R = R, .seed = 3, .handle_inadmissibles = "replace")
  drop_run <- csem(cand$sub, m_cf, .resample_method = "bootstrap", .R = R, .seed = 3, .handle_inadmissibles = "drop")
  next_run <- csem(cand$sub, m_cf, .resample_method = "bootstrap", .R = R, .seed = 4, .handle_inadmissibles = "drop")
  key <- function(M) apply(round(M, 12), 1, paste, collapse = "|")
  A <- draws_of(rep_run); Dd <- draws_of(drop_run); Nx <- draws_of(next_run)
  extra <- A[-seq_len(nrow(Dd)), , drop = FALSE]
  find$replace_seed_overlap <- list(
    setup = sprintf("PLSc, random subsample n = %d (set.seed(%d)), .R = %d, .seed = 3", cand$nn, 1000 + cand$s, R),
    admissible_with_drop = nrow(Dd),
    rows_with_replace = nrow(A),
    first_rows_of_replace_equal_drop = isTRUE(all.equal(A[seq_len(nrow(Dd)), ], Dd, tolerance = 0)),
    replacement_rows = nrow(extra),
    replacement_rows_found_in_seed_4_drop_run = sum(key(extra) %in% key(Nx)),
    info_replace = info_of(rep_run)[c("Number_of_admissibles", "Number_of_runs", "Seed", "Handle_inadmissibles")]
  )
} else find$replace_seed_overlap <- list(note = "no subsample (n in 25..80, 4 draws each) gave 15 < admissible < 38 of 40 PLSc replications without an aborting error; the seed + 1 replacement scheme is documented from source only")

# ---- 4b. CONSECUTIVE chunk seeds S, S+1, S+2 (csem_04 used seeds spaced by 1000) -------------------------
S0 <- 777L
cons_chunks <- lapply(S0 + 0:2, function(sd) draws_of(csem(d, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 50, .seed = sd)))
allc <- do.call(rbind, cons_chunks)
find$consecutive_chunk_seeds <- list(
  seeds = S0 + 0:2, R_per_chunk = 50,
  duplicated_draw_rows = sum(duplicated(round(allc, 12))),
  shifted_overlap_check = max(abs(cons_chunks[[2]][1:49, ] - cons_chunks[[1]][2:50, ])),
  note = "seminr's set.seed(seed + i) scheme makes seed S+1 replay seed S shifted by one (see seminr.json); this checks whether cSEM's future.seed streams do the same"
)

# ---- 5. 'individual' sign change: draw matrix vs Number_of_admissibles --------------------------------------
ind <- try_capture(csem(weak, m_cf, .disattenuate = FALSE, .resample_method = "bootstrap", .R = 100, .seed = 9,
                        .sign_change_option = "individual", .handle_inadmissibles = "ignore"))
find$sign_change_individual <- status_of(ind, function(v) list(
  Number_of_admissibles_reported = info_of(v)$Number_of_admissibles,
  rows_in_path_draw_matrix = nrow(draws_of(v)),
  rows_in_weight_draw_matrix = nrow(draws_of(v, "Weight_estimates")),
  conclusion = "with .sign_change_option = 'individual' every replication that needs a sign flip fails inside reverseSign() with a warning and is silently missing from the draw matrix while Number_of_admissibles still counts it"
))

write_evidence("csem_resampling_followup", find, packages = c("cSEM"))
