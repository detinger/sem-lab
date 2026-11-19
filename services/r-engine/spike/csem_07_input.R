# Phase 0 spike - cSEM behaviour on missing data and malformed input.
#
#   - NA in indicators (error? listwise? pairwise?)
#   - non-numeric column (character, factor), logical column
#   - zero-variance indicator
#   - unknown indicator name in the model, extra unused columns
#
# Evidence: docs/validation/phase-0/evidence/r/csem_input.json

source(file.path(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])), "_common.R"))
suppressPackageStartupMessages(library(cSEM))

d <- load_tam()
n <- nrow(d)
m <- tam_model_syntax("=~")
find <- list(csem_arguments_mentioning_missing = grep("missing|impute|^\\.na", names(formals(csem)), ignore.case = TRUE, value = TRUE),
             csem_argument_names = names(formals(csem)))
fit_info <- function(v) list(n_used = nrow(v$Information$Data), paths = csem_paths_df(v)$est)

# ---- NA ------------------------------------------------------------------------------------
dn <- d
na_rows <- c(3, 50, 400, 777, 1000)
dn$USEF1[na_rows] <- NA
dn$BI2[c(10, 50)] <- NA
tc_na <- try_capture(csem(dn, m, .disattenuate = FALSE))
listwise <- csem(dn[stats::complete.cases(dn), ], m, .disattenuate = FALSE)
find$na_in_indicators <- list(
  setup = "USEF1 NA in 5 rows, BI2 NA in 2 rows (1 row overlaps) -> 6 incomplete rows",
  incomplete_rows = sum(!stats::complete.cases(dn)),
  run = status_of(tc_na, fit_info),
  listwise_reference_paths = csem_paths_df(listwise)$est,
  max_abs_diff_vs_listwise = if (tc_na$ok) max_abs_diff(csem_paths_df(tc_na$value)$est, csem_paths_df(listwise)$est) else NULL
)
dn_unused <- d; dn_unused$extra <- NA_real_
find$na_only_in_unused_column <- status_of(try_capture(csem(dn_unused, m, .disattenuate = FALSE)), fit_info)

# ---- non-numeric -----------------------------------------------------------------------------
dc <- d; dc$EOU3 <- as.character(dc$EOU3)
df_ <- d; df_$EOU3 <- factor(df_$EOU3)
dch <- d; dch$EOU3 <- as.character(dch$EOU3); dch$EOU3[5] <- "n/a"
dl <- d; dl$EOU3 <- dl$EOU3 > 4
du <- d; du$note <- "free text"
base <- csem(d, m, .disattenuate = FALSE)
cmp <- function(v) list(n_used = nrow(v$Information$Data), max_abs_path_diff_vs_numeric = max_abs_diff(csem_paths_df(v)$est, csem_paths_df(base)$est),
                        type_of_indicator_correlation = v$Information$Type_of_indicator_correlation)
find$non_numeric <- list(
  character_digits = status_of(try_capture(csem(dc, m, .disattenuate = FALSE)), cmp),
  character_with_text_value = status_of(try_capture(csem(dch, m, .disattenuate = FALSE)), cmp),
  factor = status_of(try_capture(csem(df_, m, .disattenuate = FALSE)), cmp),
  logical = status_of(try_capture(csem(dl, m, .disattenuate = FALSE)), cmp),
  unused_character_column = status_of(try_capture(csem(du, m, .disattenuate = FALSE)), cmp)
)

# ---- zero variance ------------------------------------------------------------------------------
dz <- d; dz$ATT2 <- 4
find$zero_variance_indicator <- status_of(try_capture(csem(dz, m, .disattenuate = FALSE)), function(v) list(
  verify = as.list(unlist(verify(v))), weights_ATU = vec_named(v$Estimates$Weight_estimates["ATU", TAM_BLOCKS$ATU])))
dz2 <- d; dz2$BI1 <- 4; dz2$BI2 <- 4; dz2$BI3 <- 4
find$zero_variance_whole_block <- status_of(try_capture(csem(dz2, m, .disattenuate = FALSE)))

# ---- naming problems -------------------------------------------------------------------------------
find$unknown_indicator_in_model <- status_of(try_capture(csem(d, sub("BI3", "BI9", m), .disattenuate = FALSE)))
find$extra_unused_numeric_columns <- status_of(try_capture({ dx <- d; dx$zz <- stats::rnorm(n); csem(dx, m, .disattenuate = FALSE) }), cmp)
find$duplicate_indicator_in_two_blocks <- status_of(try_capture(csem(d, sub("BI =~ BI1", "BI =~ ATT1 + BI1", m), .disattenuate = FALSE)))
find$too_few_rows <- status_of(try_capture(csem(d[1:5, ], m, .disattenuate = FALSE)), function(v) list(verify = as.list(unlist(verify(v)))))

write_evidence("csem_input", find, packages = c("cSEM"))
