#' Simulated ice cream liking data
#'
#' Simulated ratings from 120 consumers who each rated 10 ice cream flavors
#' on the 9-point hedonic scale (1 = dislike extremely, 5 = neither like nor
#' dislike, 9 = like extremely). This is a small data set for first
#' examples.
#'
#' The data comes from a latent class model with four consumer segments
#' (traditional, chocolate lovers, fruit lovers, and adventurous). The
#' segments make the ratings of similar flavors correlated, as in real
#' consumer data. The data is simulated and does not describe real
#' consumers or products.
#'
#' A common way to define reach from hedonic ratings is the top-2 box: a
#' flavor reaches a consumer who rates it 8 or 9. Use `icecream >= 8` as
#' the reach matrix. A lower threshold such as `icecream >= 7` gives more
#' reach per flavor.
#'
#' @format A data frame with 120 rows (consumers) and 10 integer columns
#'   (flavors), with ratings from 1 to 9 and no missing values.
#' @source Simulated with `data-raw/simulated.R` in the package source.
#' @seealso [chips] and [cafe] for larger data sets.
#' @examples
#' reach <- icecream >= 8
#' colMeans(reach)
#' turf(reach, size = 3)
"icecream"

#' Simulated potato chip purchase intent data
#'
#' Simulated purchase intent from 600 consumers for 24 potato chip flavors
#' on a 5-point scale (1 = definitely would not buy, 3 = might or might not
#' buy, 5 = definitely would buy). This is a medium-size data set.
#'
#' The data comes from a latent class model with five consumer segments
#' (classic, heat seekers, tangy, cheese, and foodie). The segments make the
#' ratings of similar flavors correlated. The data is simulated and does not
#' describe real consumers or products.
#'
#' A common way to define reach from purchase intent is the top-2 box: a
#' flavor reaches a consumer who answers 4 or 5. Use `chips >= 4` as the
#' reach matrix.
#'
#' @format A data frame with 600 rows (consumers) and 24 integer columns
#'   (flavors), with answers from 1 to 5 and no missing values.
#' @source Simulated with `data-raw/simulated.R` in the package source.
#' @seealso [icecream] for a smaller data set and [cafe] for a larger one.
#' @examples
#' reach <- chips >= 4
#' sort(colMeans(reach), decreasing = TRUE)
#' turf_sizes(reach, sizes = 1:4)
"chips"

#' Simulated cafe drink data
#'
#' Simulated answers from 2500 customers who marked which of 40 cafe drinks
#' they would order. A 1 means that the customer would order the drink.
#' This is a large data set, and it is already a reach matrix.
#'
#' The data comes from a latent class model with six customer segments
#' (coffee purists, everyday milk coffee, sweet drinks, tea, wellness, and
#' family). The segments make the answers for similar drinks correlated.
#' Some customers would order no drink. The data is simulated and does not
#' describe real customers or products.
#'
#' Run time grows with the portfolio size. On this data, one [turf()] call
#' takes about 0.3 seconds for size 2 and about 4 to 6 seconds for sizes 3
#' to 8 on a recent laptop.
#'
#' @format A data frame with 2500 rows (customers) and 40 integer columns
#'   (drinks), with values 0 and 1 and no missing values.
#' @source Simulated with `data-raw/simulated.R` in the package source.
#' @seealso [icecream] and [chips] for smaller data sets.
#' @examples
#' sort(colMeans(cafe), decreasing = TRUE)[1:10]
#' turf(cafe, size = 2)
"cafe"

#' Cured ham liking data
#'
#' Blind liking of 8 cured hams by 127 Norwegian consumers on a 9-point
#' hedonic scale, where 9 is the highest liking. The consumers tasted the
#' hams with no information about them.
#'
#' The columns are the product labels of the source data:
#'
#' | Ham | Style | Price range | Origin |
#' |---|---|---|---|
#' | N1 | Norwegian | Economy | Norway |
#' | N2 | Norwegian | Economy | Norway |
#' | N3 | Norwegian | Premium | Norway |
#' | N4 | Norwegian | Premium | Norway |
#' | S1 | Serrano | Economy | Spain |
#' | S2 | Serrano | Premium | Norway |
#' | S3 | Serrano | Premium | Norway |
#' | S4 | Serrano | Premium | Spain |
#'
#' Use `ham >= 7` (the top-3 box) as the reach matrix. With `ham >= 8`, 23
#' consumers like no ham enough to count as reached.
#'
#' @format A data frame with 127 rows (consumers) and 8 integer columns
#'   (hams), with ratings from 1 to 9 and no missing values.
#' @source The blind liking sheet of Berget, I. (2024). Dataset on rapid
#'   sensory methods for cured hams and associations with consumer values in
#'   the Schwartz model \[Data set\]. Zenodo. \doi{10.5281/zenodo.10996096}.
#'   Licensed under CC BY 4.0
#'   (<https://creativecommons.org/licenses/by/4.0/>). Changes: the data was
#'   reshaped to one row per consumer, and consumer IDs and all other sheets
#'   were removed. `data-raw/real.R` in the package source makes the data
#'   set.
#' @examples
#' turf(ham >= 7, size = 2)
"ham"

#' Black coffee liking data
#'
#' Liking of 27 black coffee brews by 118 consumers on the 9-point hedonic
#' scale. The brews come from a full factorial design with three brew
#' temperatures (87, 90, and 93 degrees Celsius), three strengths (1, 1.25,
#' and 1.5 percent total dissolved solids), and three percent extractions
#' (16, 20, and 24 percent). The column names give these three values: for
#' example, `87-1.0-16` is the brew at 87 degrees, 1 percent total dissolved
#' solids, and 16 percent extraction.
#'
#' The products here are recipes of one coffee, not market products. A TURF
#' question for this data is which few brew recipes a cafe should offer so
#' that most consumers find one they like.
#'
#' Use `coffee >= 8` (the top-2 box) as the reach matrix. With `coffee >= 7`,
#' two or three brews reach most consumers.
#'
#' @format A data frame with 118 rows (consumers) and 27 integer columns
#'   (brews), with ratings from 1 to 9 and no missing values.
#' @source The liking column of Ristenpart, W., Cotter, A. R., & Guinard,
#'   J.-X. (2023). Consumer preference data for black coffee \[Data set\].
#'   Dryad. \doi{10.25338/B8993H}. Dedicated to the public domain under CC0
#'   1.0. `data-raw/real.R` in the package source makes the data set.
#' @references Cotter, A. R., Batali, M. E., Ristenpart, W. D., & Guinard,
#'   J.-X. (2021). Consumer preferences for black coffee are spread over a
#'   wide range of brew strengths and extraction yields. *Journal of Food
#'   Science*, 86(1), 194-205. \doi{10.1111/1750-3841.15561}
#' @examples
#' turf_sizes(coffee >= 8, sizes = 1:4)
"coffee"

#' Thanksgiving pie data
#'
#' The pies that 980 US respondents said are typically served at their
#' Thanksgiving dinner, from a FiveThirtyEight survey in November 2015. A 1
#' means that the pie is served. Only respondents who celebrate Thanksgiving
#' are included. It is already a reach matrix.
#'
#' The question is about the pies served in the respondent's household, not
#' about the pies that the respondent likes. A TURF question for this data
#' is which few pies a bakery should make so that most households get a pie
#' they serve.
#'
#' @format A data frame with 980 rows (respondents) and 10 integer columns
#'   (pies), with values 0 and 1 and no missing values.
#' @source The pie questions of FiveThirtyEight (2015). thanksgiving-2015
#'   \[Data set\].
#'   <https://github.com/fivethirtyeight/data/tree/master/thanksgiving-2015>.
#'   Licensed under CC BY 4.0
#'   (<https://creativecommons.org/licenses/by/4.0/>). Changes: the answers
#'   were coded as 0 and 1, the "None" and "Other" answers and all other
#'   questions were removed, and only respondents who celebrate Thanksgiving
#'   were kept. `data-raw/real.R` in the package source makes the data set.
#' @examples
#' colMeans(pies)
#' turf(pies, size = 3)
"pies"

#' Lunch bag purchase data
#'
#' Which of 14 lunch bag designs each of 1175 customers of a UK online
#' retailer bought from December 2010 to December 2011. A 1 means that the
#' customer bought the design at least once. It is already a reach matrix.
#'
#' A TURF question for this data is which few designs the retailer should
#' keep so that most of these customers can still buy a design they bought
#' before. Many of the customers are wholesalers.
#'
#' @format A data frame with 1175 rows (customers) and 14 integer columns
#'   (designs), with values 0 and 1 and no missing values.
#' @source Chen, D. (2015). Online Retail \[Data set\]. UCI Machine Learning
#'   Repository. \doi{10.24432/C5BW33}. Licensed under CC BY 4.0
#'   (<https://creativecommons.org/licenses/by/4.0/>). Changes: only
#'   purchases of lunch bags by known customers were kept, cancellations
#'   were removed, and the purchases were coded as 0 and 1 for each customer
#'   and design. Customer IDs were removed. `data-raw/real.R` in the package
#'   source makes the data set.
#' @references Chen, D., Sain, S. L., & Guo, K. (2012). Data mining for the
#'   online retail industry: A case study of RFM model-based customer
#'   segmentation using data mining. *Journal of Database Marketing &
#'   Customer Strategy Management*, 19(3), 197-208.
#'   \doi{10.1057/dbm.2012.17}
#' @examples
#' turf_sizes(lunchbags, sizes = 1:4)
"lunchbags"
