# Lexicographic optimum by full enumeration, for checking turf().
brute_force <- function(a, k, tiebreak) {
  r <- colSums(a)
  cand <- which(r > 0)
  combos <- if (length(cand) == k) matrix(cand, ncol = 1) else combn(cand, k)
  reach <- apply(combos, 2, function(p) sum(rowSums(a[, p, drop = FALSE]) > 0))
  freq <- apply(combos, 2, function(p) sum(r[p]))
  inv <- apply(combos, 2, function(p) sum(1 / r[p]))
  keep <- reach == max(reach)
  for (t in tiebreak) {
    v <- if (t == "frequency") -freq else inv
    keep <- keep & abs(v - min(v[keep])) < 1e-12
  }
  list(
    reach = max(reach),
    frequency = freq[keep][1],
    penetration = k / inv[keep][1],
    winners = combos[, keep, drop = FALSE]
  )
}

# Products 2 and 3, 1 and 5, 2 and 4, and 4 and 5 all reach 7 of the 8
# respondents. Of these, 2 and 3 and also 4 and 5 have the highest frequency
# (8). Products 2 and 3 have the higher harmonic mean of individual reach
# (4.00 against 3.75).
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

test_that("the simulated example gives the brute-force optimum", {
  set.seed(1234)
  reach <- turf_simulate()
  p <- turf(reach, 5)
  expect_equal(p$products, c(5L, 14L, 16L, 28L, 29L))
  expect_equal(p$names, c("P5", "P14", "P16", "P28", "P29"))
  expect_equal(p$reach, 948L)
  expect_equal(p$frequency, 2174)
  expect_equal(p$reach_prop, 0.948)
})

test_that("tie-breaks apply in order", {
  p <- turf(tie_matrix, 2, tiebreak = character(0))
  expect_equal(p$reach, 7L)

  p <- turf(tie_matrix, 2, tiebreak = "frequency")
  expect_equal(p$reach, 7L)
  expect_equal(p$frequency, 8)
  expect_true(identical(p$products, 2:3) || identical(p$products, 4:5))

  p <- turf(tie_matrix, 2)
  expect_equal(p$products, 2:3)
  expect_equal(p$frequency, 8)
  expect_equal(p$penetration, 4)
})

test_that("turf() matches brute force on random matrices", {
  orders <- list(
    character(0), "frequency", "penetration",
    c("frequency", "penetration"), c("penetration", "frequency")
  )
  # Seeds 16, 62, and 361 found solver problems during development.
  for (seed in c(16, 62, 361, 1:40)) {
    set.seed(seed)
    n <- sample(8:40, 1)
    m <- sample(4:10, 1)
    a <- matrix(rbinom(n * m, 1, runif(1, 0.1, 0.5)), n, m)
    for (k in seq_len(sum(colSums(a) > 0))) {
      for (tb in orders) {
        b <- brute_force(a, k, tb)
        p <- turf(a, k, tb)
        info <- sprintf("seed %d, size %d, tiebreak '%s'", seed, k,
                        paste(tb, collapse = ", "))
        expect_equal(p$reach, b$reach, info = info)
        if ("frequency" %in% tb) {
          expect_equal(p$frequency, b$frequency, info = info)
        }
        if ("penetration" %in% tb) {
          expect_equal(p$penetration, b$penetration, info = info)
        }
        found <- apply(b$winners, 2, function(w) setequal(w, p$products))
        expect_true(any(found), info = info)
      }
    }
  }
})

test_that("turf_min_cover() finds the smallest full cover", {
  set.seed(1234)
  reach <- turf_simulate()
  cover <- turf_min_cover(reach)
  expect_equal(cover$size, 12L)
  expect_equal(cover$reach, 1000L)
  expect_lt(turf(reach, 11)$reach, 1000L)

  for (seed in 1:30) {
    set.seed(seed)
    a <- matrix(rbinom(20 * 8, 1, 0.2), 20, 8)
    cover <- turf_min_cover(a)
    reachable <- sum(rowSums(a) > 0)
    expect_equal(cover$reach, reachable)
    if (cover$size > 1) {
      expect_lt(brute_force(a, cover$size - 1, character(0))$reach, reachable)
    }
  }
})

test_that("turf_sizes() returns one row per size", {
  set.seed(1234)
  reach <- turf_simulate(n_respondents = 300, n_products = 12)
  tab <- turf_sizes(reach)
  cover <- turf_min_cover(reach)
  expect_equal(tab$size, seq_len(cover$size))
  expect_true(all(diff(tab$reach) >= 0))
  expect_equal(tab$reach[nrow(tab)], sum(rowSums(reach) > 0))
  expect_equal(tab$reach[3], turf(reach, 3)$reach)
  expect_named(
    tab, c("size", "reach", "reach_prop", "frequency", "penetration", "products")
  )
})

test_that("respondents and products with no reach are handled", {
  a <- rbind(tie_matrix, 0, 0)
  a <- cbind(a, 0)
  p <- turf(a, 2)
  expect_equal(p$products, 2:3)
  expect_equal(p$respondents, 10L)
  expect_equal(p$reach_prop, 0.7)
  expect_error(turf(a, 6), "only 5 products")
})

test_that("logical matrices and data frames give the same result", {
  p <- turf(tie_matrix, 2)
  expect_equal(turf(tie_matrix == 1, 2)$products, p$products)
  df <- as.data.frame(tie_matrix)
  expect_equal(turf(df, 2)$names, c("V2", "V3"))
})

test_that("bad input gives clear errors", {
  expect_error(turf(tie_matrix, 0), "whole number")
  expect_error(turf(tie_matrix, 1.5), "whole number")
  expect_error(turf(tie_matrix, c(1, 2)), "whole number")
  expect_error(turf(tie_matrix, 2, tiebreak = "reach"), "should be one of")
  bad <- tie_matrix
  bad[1, 1] <- 2
  expect_error(turf(bad, 2), "only 0 and 1")
  bad[1, 1] <- NA
  expect_error(turf(bad, 2), "missing values")
  expect_error(turf(matrix(0, 3, 3), 1), "only 0 products")
  expect_error(turf_min_cover(matrix(0, 3, 3)), "No product")
  expect_error(turf(data.frame(a = c("x", "y")), 1), "numeric or logical")
})

test_that("print() shows the portfolio", {
  expect_output(print(turf(tie_matrix, 2)), "P2, P3")
  expect_output(print(turf(tie_matrix, 2)), "7 of 8 respondents")
})

test_that("a later stage cannot make an earlier criterion worse", {
  # lp_solve meets the penetration bound only to within its tolerance. Here
  # the frequency stage returned products 3 and 4, with a penetration about
  # 5e-9 below the optimum of products 1 and 2.
  n <- 20000
  pattern <- rbind(c(1, 0, 1, 0), c(1, 0, 0, 1), c(0, 1, 1, 0), c(0, 1, 0, 1))
  a <- pattern[rep(1:4, c(n / 2 - 1, n / 2 + 1, n / 2, n / 2)), ]
  p <- turf(a, 2, c("penetration", "frequency"))
  expect_equal(p$products, c(1, 2))
  expect_identical(p$penetration, 20000)
})

test_that("a retried stage finds the true optimum on the later criterion", {
  # Pairs 1-2 and 3-4 tie exactly on penetration, and pair 5-6 is about 1e-9
  # (relative) worse. The frequency stage returned pair 5-6. Keeping the
  # earlier pair 1-2 would lose frequency; the optimum is pair 3-4.
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
  p <- turf(a, 2, c("penetration", "frequency"))
  expect_equal(p$products, c(3, 4))
  expect_equal(p$frequency, 42720)
})

test_that("identical products do not flood the penetration stage", {
  set.seed(3)
  base <- matrix(rbinom(300 * 4, 1, 0.3), 300)
  a <- base[, c(rep(1, 12), 2:4)]
  expect_no_warning(p <- turf(a, 3))
  b <- brute_force(a, 3, c("frequency", "penetration"))
  expect_equal(p$reach, b$reach)
  expect_equal(p$frequency, b$frequency)
  expect_equal(p$penetration, b$penetration)
})

test_that("turf_simulate() checks its arguments", {
  expect_error(turf_simulate(10, 2.9), "`n_products` must be")
  expect_error(turf_simulate(0, 3), "`n_respondents` must be")
  expect_error(turf_simulate(10, 3, 1.1), "`max_prob` must be")
  expect_error(turf_simulate(10, 3, NA), "`max_prob` must be")
})
