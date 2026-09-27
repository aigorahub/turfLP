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

  # Variable n + m + 1 is a continuous copy of the penetration sum, so that
  # one row can bound penetration.
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

  # Identical products give identical portfolios when swapped. Select them in
  # column order (x_first >= x_second >= ...), so that each set of equivalent
  # portfolios is searched once.
  col_keys <- vapply(seq_len(m), function(j) {
    paste(which(a[, j] == 1), collapse = ",")
  }, character(1))
  for (j in which(duplicated(col_keys))) {
    prev <- max(which(col_keys[seq_len(j - 1)] == col_keys[j]))
    model <- add_row(model, coef = on_vars(x = replace(numeric(m), c(prev, j),
                                                      c(1, -1))),
                     dir = ">=", rhs = 0)
  }
  objectives <- list(
    reach = list(
      name = "reach", direction = "min", coef = on_vars(z = 1),
      value = function(sel) n - sum(rowSums(a[, sel, drop = FALSE]) > 0)
    ),
    frequency = list(
      name = "frequency", direction = "max", coef = on_vars(x = cand_reach),
      value = function(sel) sum(cand_reach[sel])
    ),
    penetration = list(
      name = "penetration", direction = "min", coef = on_vars(pen = 1),
      value = function(sel) sum(pen_coef[sel])
    )
  )

  # Solve one stage, then check the result from the selected products.
  # The solver meets bounds only to within its tolerance, so it can return
  # products that are slightly worse on an earlier criterion. Cut off those
  # exact products and solve again. The previous products meet every bound
  # exactly and are never cut, so they stay feasible. `status` is "ok",
  # "none" (no other valid portfolio is feasible), "limit" (`max_solves`
  # solves), "time" (past `deadline`), or "invalid" (the solver returned a
  # vector that does not select `size` products; a cut built from it could
  # remove valid portfolios).
  max_solves <- 100
  exclude <- function(model, selected) {
    add_row(model, coef = on_vars(x = selected), dir = "<=", rhs = size - 1)
  }
  next_valid <- function(model, obj, earlier, previous, deadline = Inf) {
    for (i in seq_len(max_solves)) {
      remaining <- deadline - proc.time()[["elapsed"]]
      if (remaining <= 0) {
        return(list(status = "time", model = model))
      }
      sol <- solve_lp(obj$direction, obj$coef, model, x_vars, obj$name,
                      soft = !is.null(previous), time_limit = remaining)
      if (is.null(sol)) {
        return(list(status = "none", model = model))
      }
      if (identical(sol, "time")) {
        return(list(status = "time", model = model))
      }
      x <- sol[x_vars]
      selected <- x > 0.5
      if (anyNA(x) || sum(selected) != size || any(abs(x - selected) > 1e-6)) {
        if (is.null(previous)) {
          stop(sprintf(
            "HiGHS returned an invalid solution in the %s stage.",
            obj$name
          ), call. = FALSE)
        }
        return(list(status = "invalid", model = model))
      }
      if (is.null(previous) ||
          !worse_on_earlier(earlier, selected, previous, size)) {
        return(list(status = "ok", selected = selected, model = model))
      }
      model <- exclude(model, selected)
    }
    list(status = "limit", model = model)
  }
  unfinished <- function(stage, status, earlier_exact = TRUE) {
    warning(sprintf(paste(
      "The %s stage did not finish (%s). The portfolio is optimal on",
      if (earlier_exact) {
        "the earlier criteria but"
      } else {
        "penetration only to within the solver tolerance and"
      },
      "may not be optimal on %s."
    ), stage, switch(status,
      limit = sprintf("%d solves", max_solves),
      time = sprintf("time limit of %g seconds", max_pool_seconds),
      invalid = "HiGHS returned an invalid solution",
      none = "HiGHS found no valid portfolio"
    ), stage), call. = FALSE)
  }

  # The pool limits are options only so that the tests can reach them.
  max_pool <- getOption("turfLP.max_pool", 1000)
  max_pool_seconds <- getOption("turfLP.max_pool_seconds", 30)
  stages <- c("reach", tiebreak)
  previous <- NULL
  for (s in seq_along(stages)) {
    obj <- objectives[[stages[s]]]
    earlier <- objectives[stages[seq_len(s - 1)]]
    res <- next_valid(model, obj, earlier, previous)
    if (res$status != "ok") {
      unfinished(stages[s], res$status)
      break
    }
    model <- res$model
    selected <- res$selected

    if (stages[s] == "penetration") {
      # Penetration is not a whole number, and HiGHS works to about 1e-9,
      # so its optimum is not exact. The optimum is no worse than these
      # products, so bound penetration by their value and collect every
      # valid portfolio that meets the bound, excluding each one found and
      # solving again. When no other portfolio is feasible, the pool holds
      # every portfolio that is optimal on penetration, and R picks the best
      # on penetration and any later criterion.
      without_pool <- model
      bound <- obj$value(selected)
      pool <- list(selected)
      last <- selected
      model <- add_row(model, coef = obj$coef, dir = "<=", rhs = bound)
      status <- "full"
      deadline <- proc.time()[["elapsed"]] + max_pool_seconds
      for (i in seq_len(max_pool)) {
        model <- exclude(model, last)
        res <- next_valid(model, obj, earlier, previous, deadline)
        model <- res$model
        if (res$status != "ok") {
          status <- if (res$status == "none") "complete" else res$status
          break
        }
        last <- res$selected
        # Skip products that meet the bound only within the solver tolerance.
        if (obj$value(last) <= bound + tolerance(bound, size)) {
          pool <- c(pool, list(last))
        }
      }

      if (status == "complete") {
        selected <- best_of(pool, objectives[stages[s:length(stages)]], size)
      } else {
        warning(sprintf(paste(
          "The search for the penetration optimum stopped (%s). The",
          "penetration is optimal only to within the solver tolerance",
          "(about 1e-9)."
        ), switch(status,
          full = sprintf("more than %d portfolios are within the solver tolerance", max_pool),
          time = sprintf("time limit of %g seconds", max_pool_seconds),
          limit = sprintf("%d solves", max_solves),
          invalid = "HiGHS returned an invalid solution"
        )), call. = FALSE)
        selected <- best_of(pool, list(obj), size)
        # The pool may miss the best portfolio on a later criterion
        # (frequency), so that stage goes back to the solver, with
        # penetration bounded by the value of the best portfolio.
        if (s < length(stages)) {
          res <- next_valid(
            add_row(without_pool, coef = obj$coef, dir = "<=",
                    rhs = obj$value(selected)),
            objectives[[stages[s + 1]]], objectives[stages[seq_len(s)]],
            selected, proc.time()[["elapsed"]] + max_pool_seconds
          )
          if (res$status == "ok") {
            selected <- res$selected
          } else {
            unfinished(stages[s + 1], res$status, earlier_exact = FALSE)
          }
        }
      }
      break
    }

    previous <- selected
    if (s < length(stages)) {
      # Fix this criterion at the value that the selected products actually
      # give, not at the solver's value for the continuous variables. Reach
      # and frequency are whole numbers, so the bound needs no tolerance.
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
  selected <- sol > 0.5

  # Check the solver's result from the selected products, as turf() does
  # (docs/algorithm.md section 11): every model respondent is covered and
  # the solution is integral.
  covered <- rowSums(a[, selected, drop = FALSE]) > 0
  if (anyNA(sol) || !all(covered) || any(abs(sol - selected) > 1e-6)) {
    stop("HiGHS returned an invalid solution in the set cover stage.",
         call. = FALSE)
  }

  new_portfolio(reach, cand[selected])
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
#' reach <- turf_simulate(n_respondents = 300, n_products = 15)
#' turf_sizes(reach, sizes = 1:4)
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

# Solve one stage with HiGHS. `model` holds the constraints as triplets
# (row, column, value) with their directions and right-hand sides. Variables
# are at least 0, and the variables in `binary` are 0 or 1. With
# `soft = TRUE`, an infeasible model gives NULL, the time limit gives "time",
# and any other failure gives NA; otherwise all stop with an error.
solve_lp <- function(direction, objective, model, binary, stage,
                     soft = FALSE, time_limit = Inf) {
  n_vars <- length(objective)
  types <- rep("C", n_vars)
  types[binary] <- "I"
  upper <- rep(Inf, n_vars)
  upper[binary] <- 1
  res <- highs::highs_solve(
    L = objective,
    lower = rep(0, n_vars),
    upper = upper,
    A = Matrix::sparseMatrix(
      i = model$triplets[, 1], j = model$triplets[, 2],
      x = model$triplets[, 3], dims = c(length(model$rhs), n_vars)
    ),
    lhs = ifelse(model$dir == "<=", -Inf, model$rhs),
    rhs = ifelse(model$dir == ">=", Inf, model$rhs),
    types = types,
    maximum = direction == "max",
    # HiGHS 1.14 presolve returned a wrong optimum on a 7 by 4 test matrix
    # (5 unreached respondents where 4 is optimal), so presolve is off.
    control = highs::highs_control(
      time_limit = time_limit,
      presolve = "off",
      mip_rel_gap = 0,
      mip_abs_gap = 0,
      primal_feasibility_tolerance = 1e-9,
      mip_feasibility_tolerance = 1e-9
    )
  )
  if (res$status_message == "Optimal") {
    return(res$primal_solution)
  }
  if (soft) {
    return(switch(res$status_message,
      "Infeasible" = NULL,
      "Time limit reached" = "time",
      NA
    ))
  }
  stop(sprintf(
    "HiGHS did not find a solution in the %s stage (%s).",
    stage, res$status_message
  ), call. = FALSE)
}

# Criterion values count as equal when they differ by less than the
# rounding error of a sum of `size` doubles, 16 * size * machine epsilon
# (relative). Reach and frequency are whole numbers, so this compares them
# exactly. Values are signed so that smaller is better.
signed_value <- function(obj, selected) {
  (if (obj$direction == "min") 1 else -1) * obj$value(selected)
}
tolerance <- function(value, size) {
  16 * size * .Machine$double.eps * max(1, abs(value))
}

# TRUE when the products in `selected` are lexicographically worse than the
# products in `previous` on the criteria in `objectives`, in order.
worse_on_earlier <- function(objectives, selected, previous, size) {
  for (obj in objectives) {
    new <- signed_value(obj, selected)
    old <- signed_value(obj, previous)
    if (new > old + tolerance(old, size)) {
      return(TRUE)
    }
    if (new < old - tolerance(old, size)) {
      return(FALSE)
    }
  }
  FALSE
}

# The lexicographically best portfolio in `pool` on `objectives`, in order.
best_of <- function(pool, objectives, size) {
  keep <- seq_along(pool)
  for (obj in objectives) {
    v <- vapply(pool[keep], function(sel) signed_value(obj, sel), numeric(1))
    keep <- keep[v <= min(v) + tolerance(min(v), size)]
  }
  pool[[keep[1]]]
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
