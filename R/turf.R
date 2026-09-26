#' Find the product portfolio with maximum reach
#'
#' `turf()` selects `size` products that together reach the largest number of
#' respondents. Ties on reach are broken by the criteria in `tiebreak`, in the
#' order given.
#'
#' @section Model:
#' Let \eqn{a_{ij} = 1} when product \eqn{j} reaches respondent \eqn{i}, and
#' let \eqn{r_j = \sum_i a_{ij}} be the individual reach of product \eqn{j}.
#' The binary variable \eqn{x_j} selects product \eqn{j}. The continuous
#' variable \eqn{z_i \ge 0} counts respondent \eqn{i} as not reached. The
#' constraints are
#' \deqn{z_i + \sum_j a_{ij} x_j \ge 1 \quad \textrm{for each respondent } i,}
#' \deqn{\sum_j x_j = k.}
#' For integer \eqn{x}, the smallest feasible \eqn{z_i} is 0 when a selected
#' product reaches respondent \eqn{i} and 1 when none does. Only the
#' product variables need to be integer, which keeps the solve fast.
#'
#' The stages solve in sequence. Each later stage keeps the earlier criteria at
#' their optimal values.
#'
#' * Reach: minimize \eqn{\sum_i z_i}, which maximizes the number of
#'   respondents reached.
#' * `"frequency"`: maximize \eqn{\sum_j r_j x_j}, the total number of
#'   product and respondent pairs where the product reaches the respondent.
#' * `"penetration"`: minimize \eqn{\sum_j x_j / r_j}, which maximizes the
#'   harmonic mean of the individual reaches of the selected products. When
#'   reach and frequency are fixed, this prefers portfolios whose products
#'   have similar individual reach.
#'
#' If portfolios still tie after the last stage, the solver returns one of
#' them.
#'
#' @param reach A matrix or data frame with one row per respondent and one
#'   column per product. A value of 1 (or `TRUE`) means that the product
#'   reaches the respondent. All other values must be 0 (or `FALSE`). Column
#'   names are used as product names.
#' @param size The number of products in the portfolio.
#' @param tiebreak A character vector of tie-break criteria to apply after
#'   reach, in order. Use any of `"frequency"` and `"penetration"`, or
#'   `character(0)` for reach only.
#'
#' @return An object of class `turf_portfolio`, a list with these elements:
#'   \describe{
#'     \item{`products`}{Column indices of the selected products.}
#'     \item{`names`}{Names of the selected products.}
#'     \item{`size`}{Number of selected products.}
#'     \item{`reach`}{Number of respondents that at least one selected
#'       product reaches.}
#'     \item{`reach_prop`}{`reach` divided by the number of respondents.}
#'     \item{`frequency`}{Sum of the individual reaches of the selected
#'       products.}
#'     \item{`penetration`}{Harmonic mean of the individual reaches of the
#'       selected products.}
#'     \item{`respondents`}{Number of respondents (rows of `reach`).}
#'   }
#'
#' @references
#' Serra, D. (2013). Implementing TURF analysis through binary linear
#' programming. *Food Quality and Preference*, 28(1), 382-388.
#' \doi{10.1016/j.foodqual.2012.10.001}
#'
#' Church, R., & ReVelle, C. (1974). The maximal covering location problem.
#' *Papers of the Regional Science Association*, 32(1), 101-118.
#' \doi{10.1007/BF01942293}
#'
#' Ennis, J. M., Fayle, C. M., & Ennis, D. M. (2012). eTURF: A competitive
#' TURF algorithm for large datasets. *Food Quality and Preference*, 23(1),
#' 44-48. \doi{10.1016/j.foodqual.2011.06.004}
#'
#' Miaoulis, G., Free, V., & Parsons, H. (1990). TURF: A new planning
#' approach for product line extensions. *Marketing Research*, 2(1), 28-40.
#'
#' @seealso [turf_sizes()] to solve several portfolio sizes,
#'   [turf_min_cover()] for the smallest portfolio that reaches everyone.
#'
#' @examples
#' set.seed(1234)
#' reach <- turf_simulate()
#' turf(reach, size = 5)
#'
#' # Reach only, with no tie-break
#' turf(reach, size = 5, tiebreak = character(0))
#' @export
turf <- function(reach, size, tiebreak = c("frequency", "penetration")) {
  reach <- as_reach_matrix(reach)
  tiebreak <- check_tiebreak(tiebreak)

  prod_reach <- colSums(reach)
  cand <- which(prod_reach > 0)
  size <- check_size(size, length(cand))

  # Respondents that no product reaches can never count toward reach, so they
  # stay out of the model.
  a <- reach[rowSums(reach) > 0, cand, drop = FALSE]
  n <- nrow(a)
  m <- ncol(a)
  x_vars <- n + seq_len(m)
  n_vars <- n + m + 1
  hits <- which(a == 1, arr.ind = TRUE)

  cand_reach <- prod_reach[cand]
  pen_coef <- max(cand_reach) / cand_reach

  # Variable n + m + 1 is a continuous copy of the penetration sum. If the
  # objective put these fractional coefficients on the binary variables
  # directly, lp_solve could take the GCD of only the whole-number
  # coefficients as the smallest possible gain (MIP_stepOF in lp_lib.c) and
  # prune the optimum. With the copy, it uses no such step.
  model <- list(
    triplets = rbind(
      cbind(seq_len(n), seq_len(n), 1),
      cbind(hits[, 1], n + hits[, 2], 1),
      cbind(n + 1, x_vars, 1),
      cbind(n + 2, c(x_vars, n_vars), c(-pen_coef, 1))
    ),
    dir = c(rep(">=", n), "==", "=="),
    rhs = c(rep(1, n), size, 0)
  )

  on_vars <- function(z = 0, x = 0, pen = 0) {
    c(rep(z, length.out = n), rep(x, length.out = m), pen)
  }
  objectives <- list(
    reach = list(
      direction = "min", coef = on_vars(z = 1),
      value = function(sel) n - sum(rowSums(a[, sel, drop = FALSE]) > 0)
    ),
    frequency = list(
      direction = "max", coef = on_vars(x = cand_reach),
      value = function(sel) sum(cand_reach[sel])
    ),
    penetration = list(
      direction = "min", coef = on_vars(pen = 1),
      value = function(sel) sum(pen_coef[sel])
    )
  )

  max_cuts <- 100
  stages <- c("reach", tiebreak)
  for (s in seq_along(stages)) {
    obj <- objectives[[stages[s]]]
    sol <- solve_lp(obj$direction, obj$coef, model, x_vars, stages[s])
    selected <- sol[x_vars] > 0.5

    # lp_solve meets the penetration bound and the penetration copy only to
    # within its tolerance, so a later stage can return products that are
    # slightly worse on an earlier criterion. Cut off those exact products
    # and solve again. The previous products meet every bound exactly and
    # are never cut, so a valid portfolio always remains.
    if (s > 1) {
      earlier <- objectives[stages[seq_len(s - 1)]]
      cuts <- 0
      while (worse_on_earlier(earlier, selected, previous)) {
        cuts <- cuts + 1
        if (cuts > max_cuts) {
          warning(sprintf(paste(
            "The %s stage stopped after %d retries. The portfolio is",
            "optimal on the earlier criteria but may not be optimal on %s."
          ), stages[s], max_cuts, stages[s]), call. = FALSE)
          selected <- previous
          break
        }
        model <- add_row(model, coef = on_vars(x = selected),
                         dir = "<=", rhs = size - 1)
        sol <- solve_lp(obj$direction, obj$coef, model, x_vars, stages[s])
        selected <- sol[x_vars] > 0.5
      }
    }
    previous <- selected

    if (s < length(stages)) {
      # Fix this criterion at the value that the selected products actually
      # give, not at the solver's value for the continuous variables. Reach
      # and frequency are whole numbers, so the bound needs no tolerance. A
      # small tolerance near the solver's own epsilon made lp_solve prune the
      # optimum in testing.
      model <- add_row(
        model,
        coef = obj$coef,
        dir = if (obj$direction == "min") "<=" else ">=",
        rhs = obj$value(selected)
      )
    }
  }

  new_portfolio(reach, cand[selected])
}

#' Find the smallest portfolio that reaches every reachable respondent
#'
#' `turf_min_cover()` solves the set cover problem: it finds the fewest
#' products such that every respondent that some product reaches is reached
#' by at least one selected product. Larger portfolios cannot add reach, so
#' for reach this is the largest size worth passing to [turf()]. Larger
#' portfolios can still add frequency.
#'
#' @inheritParams turf
#' @return An object of class `turf_portfolio`. See [turf()] for its
#'   elements. When several portfolios of the minimum size exist, the solver
#'   returns one of them.
#' @examples
#' set.seed(1234)
#' reach <- turf_simulate()
#' turf_min_cover(reach)
#' @export
turf_min_cover <- function(reach) {
  reach <- as_reach_matrix(reach)
  cand <- which(colSums(reach) > 0)
  if (length(cand) == 0) {
    stop("No product reaches any respondent.", call. = FALSE)
  }

  a <- reach[rowSums(reach) > 0, cand, drop = FALSE]
  hits <- which(a == 1, arr.ind = TRUE)
  model <- list(
    triplets = cbind(hits[, 1], hits[, 2], 1),
    dir = rep(">=", nrow(a)),
    rhs = rep(1, nrow(a))
  )
  x_vars <- seq_len(ncol(a))
  sol <- solve_lp("min", rep(1, ncol(a)), model, x_vars, "set cover")

  new_portfolio(reach, cand[sol > 0.5])
}

#' Find the best portfolio for each of several sizes
#'
#' `turf_sizes()` calls [turf()] once for each value in `sizes` and returns
#' the results as one table.
#'
#' @inheritParams turf
#' @param sizes The portfolio sizes to solve. The default is every size from
#'   1 to the size from [turf_min_cover()].
#' @return A data frame with one row per size and the columns `size`,
#'   `reach`, `reach_prop`, `frequency`, `penetration`, and `products`. The
#'   `products` column holds the names of the selected products, separated
#'   by commas.
#' @examples
#' set.seed(1234)
#' reach <- turf_simulate()
#' turf_sizes(reach, sizes = 1:6)
#' @export
turf_sizes <- function(reach, sizes = NULL,
                       tiebreak = c("frequency", "penetration")) {
  reach <- as_reach_matrix(reach)
  if (is.null(sizes)) {
    sizes <- seq_len(turf_min_cover(reach)$size)
  }
  results <- lapply(sizes, function(k) turf(reach, k, tiebreak))

  data.frame(
    size = vapply(results, function(p) p$size, integer(1)),
    reach = vapply(results, function(p) p$reach, integer(1)),
    reach_prop = vapply(results, function(p) p$reach_prop, numeric(1)),
    frequency = vapply(results, function(p) p$frequency, numeric(1)),
    penetration = vapply(results, function(p) p$penetration, numeric(1)),
    products = vapply(
      results, function(p) paste(p$names, collapse = ", "), character(1)
    ),
    stringsAsFactors = FALSE
  )
}

#' @export
print.turf_portfolio <- function(x, ...) {
  cat("TURF portfolio of", x$size, "products\n")
  cat("Products:   ", paste(x$names, collapse = ", "), "\n")
  cat(sprintf(
    "Reach:        %d of %d respondents (%.1f%%)\n",
    x$reach, x$respondents, 100 * x$reach_prop
  ))
  cat(sprintf("Frequency:    %s\n", format(x$frequency)))
  cat(sprintf("Penetration:  %.2f\n", x$penetration))
  invisible(x)
}

# Convert `reach` to a numeric 0/1 matrix with column names, or stop.
as_reach_matrix <- function(reach) {
  if (is.data.frame(reach)) {
    reach <- as.matrix(reach)
  }
  if (!is.matrix(reach) || !(is.numeric(reach) || is.logical(reach))) {
    stop("`reach` must be a numeric or logical matrix or data frame.",
         call. = FALSE)
  }
  if (nrow(reach) == 0 || ncol(reach) == 0) {
    stop("`reach` must have at least one row and one column.", call. = FALSE)
  }
  if (anyNA(reach)) {
    stop("`reach` must not contain missing values.", call. = FALSE)
  }
  storage.mode(reach) <- "double"
  if (!all(reach == 0 | reach == 1)) {
    stop("`reach` must contain only 0 and 1, or FALSE and TRUE.",
         call. = FALSE)
  }
  if (is.null(colnames(reach))) {
    colnames(reach) <- paste0("P", seq_len(ncol(reach)))
  }
  reach
}

check_size <- function(size, max_size) {
  if (!is.numeric(size) || length(size) != 1 || !is.finite(size) ||
      size < 1 || size != round(size)) {
    stop("`size` must be a single whole number of 1 or more.", call. = FALSE)
  }
  if (size > max_size) {
    stop(sprintf(
      "`size` is %d, but only %d products reach at least one respondent.",
      as.integer(size), max_size
    ), call. = FALSE)
  }
  as.integer(size)
}

check_tiebreak <- function(tiebreak) {
  if (length(tiebreak) == 0) {
    return(character(0))
  }
  unique(match.arg(tiebreak, c("frequency", "penetration"), several.ok = TRUE))
}

# Solve one stage with lpSolve. `model` holds the constraints as triplets
# (row, column, value) with their directions and right-hand sides.
solve_lp <- function(direction, objective, model, binary, stage) {
  res <- lpSolve::lp(
    direction = direction,
    objective.in = objective,
    const.dir = model$dir,
    const.rhs = model$rhs,
    dense.const = model$triplets,
    binary.vec = binary
  )
  if (res$status != 0) {
    stop(sprintf(
      "lpSolve did not find a solution in the %s stage (status %d).",
      stage, res$status
    ), call. = FALSE)
  }
  res$solution
}

# TRUE when the products in `selected` are lexicographically worse than the
# products in `previous` on the criteria in `objectives`, in order. Values
# within a relative 1e-12 count as equal, so rounding in the penetration sum
# does not break a true tie. Reach and frequency are whole numbers and are
# compared exactly.
worse_on_earlier <- function(objectives, selected, previous) {
  for (obj in objectives) {
    sign <- if (obj$direction == "min") 1 else -1
    new <- sign * obj$value(selected)
    old <- sign * obj$value(previous)
    tol <- 1e-12 * max(1, abs(old))
    if (new > old + tol) {
      return(TRUE)
    }
    if (new < old - tol) {
      return(FALSE)
    }
  }
  FALSE
}

add_row <- function(model, coef, dir, rhs) {
  row <- length(model$rhs) + 1
  cols <- which(coef != 0)
  model$triplets <- rbind(model$triplets, cbind(row, cols, coef[cols]))
  model$dir <- c(model$dir, dir)
  model$rhs <- c(model$rhs, rhs)
  model
}

new_portfolio <- function(reach, products) {
  products <- sort(unname(products))
  prod_reach <- colSums(reach)[products]
  reached <- sum(rowSums(reach[, products, drop = FALSE]) > 0)
  structure(
    list(
      products = products,
      names = colnames(reach)[products],
      size = length(products),
      reach = reached,
      reach_prop = reached / nrow(reach),
      frequency = sum(prod_reach),
      penetration = length(products) / sum(1 / prod_reach),
      respondents = nrow(reach)
    ),
    class = "turf_portfolio"
  )
}
