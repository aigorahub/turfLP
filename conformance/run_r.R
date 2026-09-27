# Run the shared conformance fixtures against the R package.
#
# Run from the repository root: Rscript conformance/run_r.R
# Needs jsonlite and pkgload. Exits with status 1 on any failure.
# See conformance/README.md for the pass rule.

pkgload::load_all(".", quiet = TRUE)
ns <- asNamespace("turfLP")

read_input <- function(name) {
  x <- jsonlite::fromJSON(file.path("conformance/inputs", paste0(name, ".json")))
  a <- matrix(0, x$rows, x$cols, dimnames = list(NULL, x$names))
  for (j in seq_len(x$cols)) {
    digits <- strtoi(strsplit(x$columns[j], "")[[1]], 16L)
    bits <- as.vector(rbind(digits %/% 8, digits %/% 4 %% 2, digits %/% 2 %% 2,
                            digits %% 2))
    a[, j] <- bits[seq_len(x$rows)]
  }
  a
}
inputs <- new.env()
input <- function(name) {
  if (is.null(inputs[[name]])) inputs[[name]] <- read_input(name)
  inputs[[name]]
}

failures <- character(0)
fail <- function(id, ...) failures <<- c(failures, paste0(id, ": ", ...))

near <- function(x, y, size) abs(x - y) <= 16 * size * .Machine$double.eps * max(1, abs(y))

# Every reported field must equal its recomputation from the returned indices.
check_fields <- function(id, a, p) {
  sel <- p$products
  r <- colSums(a)[sel]
  ok <- length(unique(sel)) == length(sel) && p$size == length(sel) &&
    identical(p$names, colnames(a)[sel]) &&
    p$reach == sum(rowSums(a[, sel, drop = FALSE]) > 0) &&
    p$respondents == nrow(a) &&
    isTRUE(all.equal(p$reach_prop, p$reach / nrow(a))) &&
    p$frequency == sum(r) &&
    near(p$penetration, length(sel) / sum(1 / r), length(sel))
  if (!ok) fail(id, "reported fields do not match the selected products")
}

check_expected <- function(id, p, expected, keys = names(expected)) {
  for (key in keys) {
    want <- expected[[key]]
    if (key == "penetration") {
      if (!near(p$penetration, want$value, p$size)) {
        fail(id, sprintf("penetration %.17g, expected %.17g", p$penetration, want$value))
      }
    } else if (p[[key]] != want) {
      fail(id, sprintf("%s %s, expected %s", key, p[[key]], want))
    }
  }
}

fixtures <- function(kind) {
  jsonlite::fromJSON(file.path("conformance/fixtures", paste0(kind, ".json")),
                     simplifyVector = FALSE)$cases
}

counts <- c(turf = 0, min_cover = 0, sizes = 0, bounded = 0, comparator = 0)

# Exact fixtures run with no pool time limit (conformance/README.md).
options(turfLP.max_pool_seconds = Inf)

for (case in fixtures("turf")) {
  a <- input(case$input)
  tb <- unlist(case$tiebreak)
  if (is.null(tb)) tb <- character(0)
  p <- tryCatch(turf(a, case$size, tb), error = function(e) e,
                warning = function(w) w)
  if (inherits(p, "condition")) {
    fail(case$id, conditionMessage(p))
    next
  }
  check_fields(case$id, a, p)
  check_expected(case$id, p, case$expected)
  counts["turf"] <- counts["turf"] + 1
}

for (case in fixtures("min_cover")) {
  a <- input(case$input)
  p <- turf_min_cover(a)
  check_fields(case$id, a, p)
  if (p$size != case$expected$size) fail(case$id, "cover size ", p$size)
  if (p$reach != case$expected$reachable) fail(case$id, "cover reach ", p$reach)
  counts["min_cover"] <- counts["min_cover"] + 1
}

for (case in fixtures("sizes")) {
  a <- input(case$input)
  tb <- unlist(case$tiebreak)
  if (is.null(tb)) tb <- character(0)
  sizes <- if (is.null(case$sizes)) NULL else unlist(case$sizes)
  tab <- turf_sizes(a, sizes, tb)
  want <- vapply(case$expected, function(e) e$size, numeric(1))
  if (!identical(as.numeric(tab$size), want)) {
    fail(case$id, "sizes ", paste(tab$size, collapse = ","))
    next
  }
  for (i in seq_along(case$expected)) {
    e <- case$expected[[i]]
    row <- as.list(tab[i, ])
    check_expected(sprintf("%s[%d]", case$id, i), row, e[setdiff(names(e), "size")])
  }
  counts["sizes"] <- counts["sizes"] + 1
}

for (case in fixtures("bounded")) {
  a <- input(case$input)
  old <- options(
    turfLP.max_pool = case$max_pool,
    turfLP.max_pool_seconds = if (is.null(case$max_pool_seconds)) Inf else case$max_pool_seconds
  )
  warnings <- character(0)
  p <- withCallingHandlers(
    turf(a, case$size, unlist(case$tiebreak)),
    warning = function(w) {
      warnings <<- c(warnings, conditionMessage(w))
      invokeRestart("muffleWarning")
    }
  )
  options(old)
  if (!identical(warnings, as.character(unlist(case$warnings)))) {
    fail(case$id, "warnings: ", paste(warnings, collapse = " | "))
  }
  check_fields(case$id, a, p)
  check_expected(case$id, p, case$expected)
  counts["bounded"] <- counts["bounded"] + 1
}

for (case in fixtures("comparator")) {
  obj <- list(list(direction = "min", value = function(v) v))
  got <- ns$worse_on_earlier(obj, case$new, case$old, case$size)
  if (!identical(got, case$worse)) {
    fail(sprintf("comparator size %d old %.17g new %.17g", case$size, case$old, case$new),
         "worse = ", got)
  }
  counts["comparator"] <- counts["comparator"] + 1
}

cat(sprintf("%s: %d cases\n", names(counts), counts), sep = "")
if (length(failures) > 0) {
  cat(sprintf("%d failures\n", length(failures)))
  cat(head(failures, 50), sep = "\n")
  quit(status = 1)
}
cat("all conformance fixtures pass\n")
