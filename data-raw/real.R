# Make the example data sets from public data: ham, coffee, pies, and
# lunchbags.
#
# Each section downloads the source file from a fixed URL, keeps only the
# responses that the reach matrix needs, and drops all respondent IDs and
# demographic data. See inst/COPYRIGHTS for the licenses.
#
# Needs readxl. Run from the package root: Rscript data-raw/real.R

download <- function(url, file) {
  path <- file.path(tempdir(), file)
  if (!file.exists(path)) {
    utils::download.file(url, path, mode = "wb", quiet = TRUE)
  }
  path
}

# Turn long data (one row per respondent and product) into a wide data frame
# with one row per respondent and one column per product.
to_wide <- function(respondent, product, value, products) {
  ids <- unique(respondent)
  out <- matrix(NA_integer_, length(ids), length(products),
                dimnames = list(NULL, products))
  out[cbind(match(respondent, ids), match(product, products))] <-
    as.integer(value)
  stopifnot(!anyNA(out))
  as.data.frame(out, optional = TRUE)
}

# ham: blind liking of 8 cured hams by 127 Norwegian consumers.
# Berget, I. (2024). Zenodo. https://doi.org/10.5281/zenodo.10996096
# License: CC BY 4.0.
ham_file <- download(
  paste0("https://zenodo.org/api/records/10996096/files/",
         "Cured%20ham%20rapid%20methods%20and%20consumer%20values.xlsx/",
         "content"),
  "cured_ham.xlsx"
)
ham_products <- as.data.frame(readxl::read_excel(ham_file, "Products"))
ham_products <- ham_products[order(ham_products$label), ]
ham_long <- as.data.frame(readxl::read_excel(ham_file, "BlindLiking"))
ham <- to_wide(
  ham_long$INTERNAL_ID,
  ham_products$label[match(ham_long$product, ham_products$product)],
  ham_long$Blind.liking,
  ham_products$label
)

# coffee: liking of 27 black coffee brews by 118 consumers.
# Ristenpart, W., Cotter, A. R., & Guinard, J.-X. (2023). Dryad.
# https://doi.org/10.25338/B8993H (Zenodo mirror with the same DOI).
# License: CC0 1.0.
coffee_file <- download(
  "https://zenodo.org/api/records/7542610/files/cotter_dataset.csv/content",
  "cotter_dataset.csv"
)
coffee_long <- utils::read.csv(coffee_file, fileEncoding = "latin1",
                               check.names = FALSE)
brew_parts <- do.call(rbind, strsplit(unique(coffee_long$Brew), "-"))
brews <- unique(coffee_long$Brew)[order(
  as.numeric(brew_parts[, 1]), as.numeric(brew_parts[, 2]),
  as.numeric(brew_parts[, 3])
)]
coffee <- to_wide(coffee_long$Judge, coffee_long$Brew, coffee_long$Liking,
                  brews)

# pies: pies served at the Thanksgiving dinners of 980 US respondents.
# FiveThirtyEight (2015). License: CC BY 4.0.
pies_file <- download(
  paste0("https://raw.githubusercontent.com/fivethirtyeight/data/",
         "8268ea8408ee344ecb39cb88ccf7ae4988290246/thanksgiving-2015/",
         "thanksgiving-2015-poll-data.csv"),
  "thanksgiving-2015-poll-data.csv"
)
pies_raw <- utils::read.csv(pies_file, check.names = FALSE)
pies_raw <- pies_raw[pies_raw[["Do you celebrate Thanksgiving?"]] == "Yes", ]
pie_prefix <- paste("Which type of pie is typically served at your",
                    "Thanksgiving dinner? Please select all that apply. - ")
pie_names <- c("Apple", "Buttermilk", "Cherry", "Chocolate", "Coconut cream",
               "Key lime", "Peach", "Pecan", "Pumpkin", "Sweet Potato")
pies <- as.data.frame(
  lapply(pies_raw[paste0(pie_prefix, pie_names)],
         function(x) as.integer(!is.na(x) & x != "")),
  optional = TRUE
)
names(pies) <- sub("Sweet Potato", "Sweet potato", pie_names)
rownames(pies) <- NULL

# lunchbags: which of 14 lunch bag designs 1175 customers of a UK online
# retailer bought from December 2010 to December 2011.
# Chen, D. (2015). UCI Machine Learning Repository.
# https://doi.org/10.24432/C5BW33 License: CC BY 4.0.
retail_zip <- download(
  "https://archive.ics.uci.edu/static/public/352/online+retail.zip",
  "online_retail.zip"
)
retail_file <- utils::unzip(retail_zip, "Online Retail.xlsx",
                            exdir = tempdir())
retail <- as.data.frame(readxl::read_excel(retail_file))
retail <- retail[!is.na(retail$CustomerID) & retail$Quantity > 0 &
                   !grepl("^C", retail$InvoiceNo), ]
retail$Description <- trimws(gsub("\\s+", " ", toupper(retail$Description)))
bags <- retail[grepl("^LUNCH BAG", retail$Description), ]
# Name each design by its most common description, without "LUNCH BAG".
bag_codes <- sort(unique(bags$StockCode))
bag_names <- vapply(bag_codes, function(code) {
  desc <- table(bags$Description[bags$StockCode == code])
  name <- sub("^LUNCH BAG (.*?)[.]*$", "\\1", names(desc)[which.max(desc)])
  paste0(toupper(substring(name, 1, 1)), tolower(substring(name, 2)))
}, character(1))
stopifnot(!anyDuplicated(bag_names))
bag_pairs <- unique(bags[c("CustomerID", "StockCode")])
bag_customers <- sort(unique(bag_pairs$CustomerID))
lunchbags <- matrix(0L, length(bag_customers), length(bag_codes),
                    dimnames = list(NULL, bag_names))
lunchbags[cbind(match(bag_pairs$CustomerID, bag_customers),
                match(bag_pairs$StockCode, bag_codes))] <- 1L
lunchbags <- as.data.frame(lunchbags, optional = TRUE)

usethis::use_data(ham, coffee, pies, lunchbags, overwrite = TRUE,
                  compress = "xz")
