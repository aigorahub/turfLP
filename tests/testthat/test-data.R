test_that("the example data sets have the documented shape and values", {
  specs <- list(
    icecream = list(dim = c(120, 10), values = 1:9),
    chips = list(dim = c(600, 24), values = 1:5),
    cafe = list(dim = c(2500, 40), values = 0:1),
    ham = list(dim = c(127, 8), values = 1:9),
    coffee = list(dim = c(118, 27), values = 1:9),
    pies = list(dim = c(980, 10), values = 0:1),
    lunchbags = list(dim = c(1175, 14), values = 0:1)
  )
  for (name in names(specs)) {
    data <- get(name, envir = asNamespace("turfLP"))
    expect_s3_class(data, "data.frame")
    expect_equal(dim(data), specs[[name]]$dim, info = name)
    expect_false(anyNA(data), info = name)
    expect_true(all(unlist(data) %in% specs[[name]]$values), info = name)
    expect_false(anyDuplicated(names(data)) > 0, info = name)
  }
})

test_that("the documented thresholds give valid reach matrices", {
  expect_equal(turf(icecream >= 8, size = 2)$respondents, 120)
  expect_equal(turf(chips >= 4, size = 2)$respondents, 600)
  expect_equal(turf(cafe, size = 2)$respondents, 2500)
  expect_equal(turf(ham >= 7, size = 2)$respondents, 127)
  expect_equal(turf(coffee >= 8, size = 2)$respondents, 118)
  expect_equal(turf(pies, size = 2)$respondents, 980)
  expect_equal(turf(lunchbags, size = 2)$respondents, 1175)
})
