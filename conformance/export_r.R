# Export the matrices that only R can make (they depend on R's random number
# generator or on the package data) to conformance/inputs/, and the package
# data sets to conformance/data/ as CSV. generate.py reads the inputs; the
# Python and JavaScript packages copy the CSV files.
#
# Run from the repository root: Rscript conformance/export_r.R
# The outputs are committed. Rerun only when a recipe here changes.

pkgload::load_all(".", quiet = TRUE)

dir.create("conformance/inputs", showWarnings = FALSE)
dir.create("conformance/data", showWarnings = FALSE)

# Columns as hexadecimal strings: row 1 is the most significant bit of the
# first hex digit. The last digit is padded with zero bits.
hex_column <- function(x) {
  bits <- c(as.integer(x), integer((4 - length(x) %% 4) %% 4))
  groups <- matrix(bits, nrow = 4)
  paste(sprintf("%x", colSums(groups * c(8, 4, 2, 1))), collapse = "")
}

write_input <- function(name, a, source) {
  a <- as.matrix(a)
  storage.mode(a) <- "double"
  names <- colnames(a)
  if (is.null(names)) names <- paste0("P", seq_len(ncol(a)))
  columns <- vapply(seq_len(ncol(a)), function(j) hex_column(a[, j]),
                    character(1))
  json <- paste0(
    "{\n",
    '  "name": "', name, '",\n',
    '  "source": "', source, '",\n',
    '  "rows": ', nrow(a), ",\n",
    '  "cols": ', ncol(a), ",\n",
    '  "names": [', paste0('"', names, '"', collapse = ", "), "],\n",
    '  "columns": [\n', paste0('    "', columns, '"', collapse = ",\n"), "\n  ]\n",
    "}\n"
  )
  writeLines(json, file.path("conformance/inputs", paste0(name, ".json")),
             sep = "")
}

tie_matrix <- matrix(c(
  0, 1, 0, 0, 1,
  0, 0, 1, 1, 1,
  0, 0, 1, 1, 0,
  0, 1, 0, 0, 1,
  0, 0, 1, 0, 1,
  1, 0, 0, 1, 0,
  1, 1, 0, 0, 0,
  0, 1, 1, 0, 1
), nrow = 8, byrow = TRUE)
write_input("tie-matrix", tie_matrix, "tests/testthat/test-turf.R tie_matrix")
write_input("tie-matrix-empty", cbind(rbind(tie_matrix, 0, 0), 0),
            "tie_matrix with two empty rows and one empty column")

set.seed(1234)
write_input("simulate-1234", turf_simulate(), "set.seed(1234); turf_simulate()")
set.seed(1234)
write_input("simulate-1234-300x12",
            turf_simulate(n_respondents = 300, n_products = 12),
            "set.seed(1234); turf_simulate(300, 12)")

for (seed in c(16, 62, 361, 1:40)) {
  set.seed(seed)
  n <- sample(8:40, 1)
  m <- sample(4:10, 1)
  a <- matrix(rbinom(n * m, 1, runif(1, 0.1, 0.5)), n, m)
  write_input(sprintf("random-r-%d", seed), a,
              sprintf("test-turf.R random matrix, set.seed(%d)", seed))
}
for (seed in 1:30) {
  set.seed(seed)
  write_input(sprintf("cover-r-%d", seed), matrix(rbinom(20 * 8, 1, 0.2), 20, 8),
              sprintf("test-turf.R cover matrix, set.seed(%d)", seed))
}

n <- 20000
pattern <- rbind(c(1, 0, 1, 0), c(1, 0, 0, 1), c(0, 1, 1, 0), c(0, 1, 0, 1))
a <- pattern[rep(1:4, c(n / 2 - 1, n / 2 + 1, n / 2, n / 2)), ]
write_input("stage-40000", a, "penetration bound tolerance case, 40000 x 4")
write_input("stage-40000-perm", a[, c(4, 1, 3, 2)],
            "40000 x 4 case with columns 4, 1, 3, 2 (lp_solve status 5)")

set.seed(1)
n <- 35043L
r <- c(20025L, 20025L, 16020L, 26700L, 14953L, 30304L)
a <- matrix(1, n, 6)
for (pair in 0:2) {
  ids <- sample.int(n)
  j <- 2 * pair + 1
  miss <- n - r[j]
  a[ids[seq_len(miss)], j] <- 0
  a[ids[miss + seq_len(n - r[j + 1])], j + 1] <- 0
}
write_input("retry-35043", a, "retried stage case, 35043 x 6")

set.seed(3)
base <- matrix(rbinom(300 * 4, 1, 0.3), 300)
write_input("identical-300", base[, c(rep(1, 12), 2:4)],
            "12 identical columns plus 3 others, 300 rows")

comb <- combn(16, 8)
comb <- comb[, colSums(comb <= 4) %in% 1:3, drop = FALSE]
comb <- comb[, apply(comb, 2, function(x) 1 %in% x), drop = FALSE]
set.seed(1)
chosen <- sample.int(ncol(comb), 200)
a <- matrix(0, 16, 402)
for (j in 1:200) {
  a[comb[, chosen[j]], 2 * j - 1] <- 1
  a[, 2 * j] <- 1 - a[, 2 * j - 1]
}
a[1:6, 401] <- 1
a[5:16, 402] <- 1
write_input("flood-402", a, "200 complementary pairs plus pair 401-402, 16 x 402")

set.seed(20260926)
n <- 42000L
r <- c(26318L, 27898L, 25803L, 28501L)
a <- matrix(1, n, 4)
for (i in c(1, 3)) {
  ids <- sample.int(n)
  miss <- n - r[i]
  a[ids[seq_len(miss)], i] <- 0
  a[ids[miss + seq_len(n - r[i + 1])], i + 1] <- 0
}
write_input("near-42000", a, "penetration gap 2e-13, 42000 x 4")

for (N in c(5000L, 20000L)) {
  r <- c(N - 1, N - 1, N + 2, N - 2, N + 1, N + 1)
  a <- matrix(0, 3 * N, 6)
  a[cbind(seq_len(3 * N), rep(1:3, r[1:3]))] <- 1
  set.seed(291)
  a[cbind(sample.int(3 * N), rep(4:6, r[4:6]))] <- 1
  write_input(sprintf("triple-%d", 3 * N), a,
              sprintf("two full-reach triples with a small penetration gap, N = %d", N))
}

set.seed(881)
N <- 3162L
n <- 5000L
a <- matrix(1, n, 24)
for (j in 1:11) {
  a[sample.int(2500, n - (N - 1)), j] <- 0
  a[2500 + sample.int(2500, n - (N + 1)), 11 + j] <- 0
}
ids <- sample.int(n)
miss <- n - N
a[ids[seq_len(miss)], 23] <- 0
a[ids[miss + seq_len(miss)], 24] <- 0
write_input("window-5000", a, "penetration window case, 5000 x 24")

set.seed(42)
n <- 80L
v <- matrix(0, n, 200)
for (i in 1:100) {
  repeat {
    idx <- sample.int(n, 40)
    col <- as.integer(seq_len(n) %in% idx)
    old <- v[, seq_len(2 * i - 2), drop = FALSE]
    if (sum(idx %in% 1:60) > 20 &&
        !any(apply(old, 2, function(x) all(x == col)))) break
  }
  v[idx, 2 * i - 1] <- 1
  v[-idx, 2 * i] <- 1
}
high <- matrix(0, n, 2)
high[1:60, 1] <- 1
high[c(61:80, 1:10), 2] <- 1
write_input("runtime-80x202", cbind(v, high),
            "100 complementary pairs plus a higher-frequency pair, 80 x 202")

thresholds <- list(icecream = 8, chips = 4, cafe = NA, ham = 7, coffee = 8,
                   pies = NA, lunchbags = NA)
for (name in names(thresholds)) {
  d <- get(name)
  utils::write.csv(d, file.path("conformance/data", paste0(name, ".csv")),
                   row.names = FALSE)
  t <- thresholds[[name]]
  reach <- if (is.na(t)) as.matrix(d) else as.matrix(d >= t)
  write_input(paste0("data-", name), reach,
              if (is.na(t)) sprintf("package data %s", name)
              else sprintf("package data %s >= %d", name, t))
}
