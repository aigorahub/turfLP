#' Simulate a reach matrix
#'
#' `turf_simulate()` makes a random reach matrix for examples and tests. Each
#' product gets a reach probability drawn uniformly from 0 to `max_prob`. The
#' number of respondents that the product reaches is drawn from a binomial
#' distribution with that probability, and those respondents are chosen at
#' random. Products are independent, so the simulated data has no
#' correlation between products.
#'
#' Call [set.seed()] first for reproducible results.
#'
#' @param n_respondents Number of respondents (rows).
#' @param n_products Number of products (columns).
#' @param max_prob Largest possible reach probability for a product, from 0
#'   to 1.
#' @return A numeric matrix of 0 and 1 with `n_respondents` rows and
#'   `n_products` columns named `P1`, `P2`, and so on.
#' @examples
#' set.seed(1234)
#' reach <- turf_simulate(n_respondents = 200, n_products = 10)
#' colSums(reach)
#' @export
turf_simulate <- function(n_respondents = 1000, n_products = 30,
                          max_prob = 0.5) {
  for (arg in c("n_respondents", "n_products")) {
    n <- get(arg)
    if (!is.numeric(n) || length(n) != 1 || !is.finite(n) || n < 1 ||
        n != round(n)) {
      stop(sprintf("`%s` must be a single whole number of 1 or more.", arg),
           call. = FALSE)
    }
  }
  if (!is.numeric(max_prob) || length(max_prob) != 1 ||
      !is.finite(max_prob) || max_prob < 0 || max_prob > 1) {
    stop("`max_prob` must be a single number from 0 to 1.", call. = FALSE)
  }
  prob <- stats::runif(n_products, max = max_prob)
  totals <- stats::rbinom(n_products, n_respondents, prob = prob)
  reach <- matrix(
    0, n_respondents, n_products,
    dimnames = list(NULL, paste0("P", seq_len(n_products)))
  )
  for (j in seq_len(n_products)) {
    reach[sample(n_respondents, totals[j]), j] <- 1
  }
  reach
}
