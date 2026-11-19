# tam-v1 (TEMP/Example - TAM/Data.txt, git-ignored): SEM Lab's own specification of the
# TAM model, as in services/r-engine/spike/_common.R. Used by the parity and IPMA tests.

tam_blocks <- list(PU = paste0("USEF", 1:5), PEOU = paste0("EOU", 1:5), ATU = paste0("ATT", 1:5),
                   BI = paste0("BI", 1:3), USE = paste0("USE", 1:4))
tam_struct <- list(c("PEOU", "PU"), c("PEOU", "ATU"), c("PU", "ATU"), c("PU", "BI"), c("ATU", "BI"), c("BI", "USE"))

tam_model <- function(scales = NULL) {
  list(
    constructs = lapply(names(tam_blocks), function(k) list(
      id = paste0("c_", tolower(k)), name = k, measurement = "reflective",
      indicatorIds = I(paste0("i_", tolower(tam_blocks[[k]]))))),
    indicators = lapply(unlist(tam_blocks, use.names = FALSE), function(col) list(
      id = paste0("i_", tolower(col)), name = col, column = col,
      scale = if (is.null(scales)) NULL else scales[[col]])),
    relationships = lapply(tam_struct, function(p) list(
      id = sprintf("r_%s_%s", tolower(p[1]), tolower(p[2])), kind = "structural",
      sourceId = paste0("c_", tolower(p[1])), targetId = paste0("c_", tolower(p[2]))))
  )
}

tam_csv <- function() {
  d <- utils::read.table(TAM_TXT, header = TRUE, sep = ";", dec = ".", check.names = FALSE)
  f <- tempfile(fileext = ".csv")
  utils::write.csv(d, f, row.names = FALSE)
  f
}

#' Per-indicator scale endpoints from the plain-JSON settings side file (as in Phase 0).
tam_settings_scales <- function() {
  s <- jsonlite::fromJSON(paste0(TAM_TXT, ".settings"), simplifyVector = FALSE)
  out <- list()
  for (i in s$indicators) out[[i$name]] <- list(min = i$scaleInformation$minValue, max = i$scaleInformation$maxValue)
  out
}
