# turfLP

<!-- badges: start -->
[![R-CMD-check](https://github.com/aigorahub/turfLP/actions/workflows/R-CMD-check.yaml/badge.svg)](https://github.com/aigorahub/turfLP/actions/workflows/R-CMD-check.yaml)
[![python](https://github.com/aigorahub/turfLP/actions/workflows/python.yaml/badge.svg)](https://github.com/aigorahub/turfLP/actions/workflows/python.yaml)
[![js](https://github.com/aigorahub/turfLP/actions/workflows/js.yaml/badge.svg)](https://github.com/aigorahub/turfLP/actions/workflows/js.yaml)
[![conformance](https://github.com/aigorahub/turfLP/actions/workflows/conformance-r.yaml/badge.svg)](https://github.com/aigorahub/turfLP/actions/workflows/conformance-r.yaml)
<!-- badges: end -->

turfLP is an R package for TURF analysis (total unduplicated reach and frequency) with integer linear programming. You give it a respondent by product matrix that shows which products reach which respondents. It returns the portfolio of a given size that reaches the most respondents. The result is an exact optimum, and the package does not enumerate every possible portfolio.

## Installation

```r
# install.packages("remotes")
remotes::install_github("aigorahub/turfLP")
```

The package solves the integer programs with the HiGHS solver through the [highs](https://cran.r-project.org/package=highs) package. It also uses Matrix, which comes with R.

## Python and JavaScript

The repository also has a Python package (`python/`) and a JavaScript/TypeScript package (`js/`) with the same functions. All three implementations follow one specification, [docs/algorithm.md](docs/algorithm.md), use HiGHS with the same settings, limits, and warning texts, and pass one shared conformance suite, [conformance/](conformance/), whose 1,787 fixture cases take their expected values from exact enumeration of every portfolio, not from a solver. CI runs the suite against all three on every push.

```sh
pip install turfLP     # Python 3.10 or later; import turflp
npm install turflp     # JavaScript: Node.js 20 or later, or a browser
```

See [python/README.md](python/README.md) and [js/README.md](js/README.md). The JavaScript README covers Next.js on Vercel, use in a browser, and which problem sizes to solve in the browser or on a server.

## Browser dashboard

[dashboard/](dashboard/) builds a one-file web page that runs the JavaScript port in the browser: open it, load an example data set or a CSV file, and see the best portfolio for each size with a reach curve and the reach of each product. The data does not leave the computer. Download `turflp-dashboard.html` from the [latest release](https://github.com/aigorahub/turfLP/releases/latest), or build it; see [dashboard/README.md](dashboard/README.md) for the build and the data format.

## Usage

The input is a matrix or data frame with one row per respondent and one column per product. A 1 means that the product reaches the respondent, for example because the respondent would buy it. Column names become product names.

```r
library(turfLP)

set.seed(1234)
reach <- turf_simulate()   # 1000 respondents, 30 products
turf(reach, size = 5)
#> TURF portfolio of 5 products
#> Products:    P5, P14, P16, P28, P29
#> Reach:        948 of 1000 respondents (94.8%)
#> Frequency:    2174
#> Penetration:  432.91
```

`turf_sizes()` solves a range of portfolio sizes. By default, it solves every size from 1 to the smallest portfolio that reaches every respondent that some product reaches, which `turf_min_cover()` finds (12 products in this example).

```r
turf_sizes(reach, sizes = 1:6)
#>   size reach reach_prop frequency penetration                    products
#> 1    1   469      0.469       469       469.0                         P14
#> 2    2   717      0.717       932       466.0                     P5, P14
#> 3    3   841      0.841      1344       446.5                P5, P14, P16
#> 4    4   909      0.909      1779       443.6           P5, P14, P16, P28
#> 5    5   948      0.948      2174       432.9      P5, P14, P16, P28, P29
#> 6    6   969      0.969      2560       424.3 P5, P14, P16, P26, P28, P29
```

(The penetration and reach proportion columns are rounded here.)

## Example data

The package includes four data sets from public studies and three simulated data sets. Ratings become a reach matrix with a threshold, as the last column shows. Each help page, for example `?ham`, describes the data and its source.

| Data set | Respondents | Products | Response | Reach |
|---|---:|---|---|---|
| `ham` | 127 | 8 cured hams | 9-point hedonic scale | `ham >= 7` |
| `coffee` | 118 | 27 black coffee brews | 9-point hedonic scale | `coffee >= 8` |
| `pies` | 980 | 10 Thanksgiving pies | served at home (0 or 1) | `pies` |
| `lunchbags` | 1175 | 14 lunch bag designs | bought (0 or 1) | `lunchbags` |
| `icecream` | 120 | 10 ice cream flavors | 9-point hedonic scale (simulated) | `icecream >= 8` |
| `chips` | 600 | 24 potato chip flavors | 5-point purchase intent (simulated) | `chips >= 4` |
| `cafe` | 2500 | 40 cafe drinks | would order, 0 or 1 (simulated) | `cafe` |

The public data sets and their licenses are:

- `ham`: blind liking of cured hams by Norwegian consumers. Berget (2024), Zenodo, https://doi.org/10.5281/zenodo.10996096, CC BY 4.0.
- `coffee`: liking of 27 brews from a design over brew temperature, strength, and extraction. Ristenpart, Cotter, and Guinard (2023), Dryad, https://doi.org/10.25338/B8993H, CC0 1.0.
- `pies`: pies served at Thanksgiving dinner, from a 2015 FiveThirtyEight survey. https://github.com/fivethirtyeight/data/tree/master/thanksgiving-2015, CC BY 4.0.
- `lunchbags`: lunch bag designs bought by customers of a UK online retailer in 2010 and 2011. Chen (2015), UCI Machine Learning Repository, https://doi.org/10.24432/C5BW33, CC BY 4.0.

`data-raw/real.R` downloads the source files and makes these data sets. It keeps only the responses that the reach matrix needs and removes respondent IDs and demographic data.

The simulated data sets come from latent class models, so consumers fall into segments and similar products are correlated, as in real consumer data. `data-raw/simulated.R` makes them from fixed seeds.

```r
turf(ham >= 7, size = 2)
#> TURF portfolio of 2 products
#> Products:    N4, S1
#> Reach:        98 of 127 respondents (77.2%)
#> Frequency:    118
#> Penetration:  58.98
```

The best portfolio of one size need not contain the best portfolio of a smaller size. In `ham`, N4 is in the best pair but not in the best three:

```r
turf_sizes(ham >= 7, sizes = 1:4)[, c("size", "reach", "products")]
#>   size reach       products
#> 1    1    60             S1
#> 2    2    98         N4, S1
#> 3    3   111     N2, N3, S1
#> 4    4   119 N1, N3, N4, S1
```

## How it works

Let a<sub>ij</sub> = 1 when product j reaches respondent i, and let r<sub>j</sub> be the individual reach of product j. A binary variable x<sub>j</sub> selects product j. A continuous variable z<sub>i</sub> ≥ 0 counts respondent i as not reached. The constraints are

```
z_i + sum_j a_ij x_j >= 1    for each respondent i
sum_j x_j = k                 (portfolio size)
```

For integer x, the smallest feasible z<sub>i</sub> is 0 when a selected product reaches respondent i and 1 when none does. So only the product variables must be integer. This keeps the branch and bound search small: the example above takes about 1.4 seconds. An earlier version made all the respondent variables binary, and one solve with lpSolve took about 8 minutes.

`turf()` then solves up to three stages in sequence. Each later stage keeps the earlier criteria at their optimal values.

1. Reach: minimize the sum of z, which maximizes the number of respondents reached. This is the maximal covering location problem.
2. Frequency: maximize the sum of r<sub>j</sub> x<sub>j</sub>, the total number of product and respondent pairs where the product reaches the respondent.
3. Penetration: minimize the sum of x<sub>j</sub> / r<sub>j</sub>, which maximizes the harmonic mean of the individual reaches of the selected products. When reach and frequency are fixed, this prefers portfolios whose products have similar individual reach.

The `tiebreak` argument selects and orders stages 2 and 3. For example, `tiebreak = character(0)` gives reach only. `turf_min_cover()` solves the set cover problem: the fewest products that together reach every respondent that some product reaches.

Respondents that no product reaches stay in the denominator of `reach_prop` but not in the model. Products that reach no respondent are never selected.

### Solver notes

turfLP uses HiGHS. Earlier versions used lp_solve 5.5 through lpSolve, and testing found three lp_solve problems. With fractional objective coefficients on the integer variables, lp_solve could take the GCD of only the whole-number coefficients as the smallest possible improvement (`MIP_stepOF` in `lp_lib.c`) and skip the optimum. A bound with a small tolerance ("unreached ≤ 2 + 2e-9") made it skip the optimum where the exact bound did not. After many added constraints, it reported points that broke a constraint by 1 as optimal. HiGHS avoids all three. HiGHS 1.14 presolve returned a wrong optimum on a 7 by 4 test matrix, so the package turns presolve off.

Reach and frequency are whole numbers, so the package fixes them with exact bounds. The penetration value is not a whole number, and a solver meets bounds only to within its tolerance (about 1e-9). In test cases with 35,000 to 60,000 respondents, a stage returned a portfolio slightly worse on penetration than the optimum. The package therefore decides penetration in R:

- After each stage, it computes the earlier criteria from the selected products. If the portfolio is worse on an earlier criterion, it adds a constraint that excludes that exact portfolio and solves the stage again.
- In the penetration stage, the optimum is no worse than the first solution. The package bounds penetration by that value and collects every portfolio that meets the bound, by excluding each portfolio it finds and solving again until no other portfolio is feasible. It then picks the best in R, on penetration and on frequency if frequency comes after penetration.

In R, two values count as equal when they differ by less than the rounding error of the sum, 16 × size × machine epsilon (relative, about 7e-15 for a portfolio of two products). Values that differ by less than that are treated as a tie.

The collection stops after 1000 portfolios or 30 seconds. This happens only when very many portfolios have almost the same penetration. The package then warns that the penetration is optimal only to within the solver tolerance, and the solver finds the best frequency with penetration bounded by the best value found, with another 30 seconds. If that search also stops, the package warns and returns the best portfolio on penetration. The time limits apply inside each solve, but the reach stage, a frequency stage before penetration, and the first penetration solve have no time limit. Identical product columns would make many equivalent portfolios, so the model selects identical products in column order.

### Run time

These times are for one `turf()` call with all tie-breaks, on simulated data with correlated products (Apple M5 Pro, R 4.6.1, HiGHS 1.14):

| Respondents | Products | Size 3 | Size 5 | Size 8 |
|---:|---:|---:|---:|---:|
| 500 | 18 | 0.2 s | 0.4 s | 0.5 s |
| 1000 | 30 | 7.5 s | 1.4 s | 1.3 s |
| 2000 | 40 | 3.0 s | 6.6 s | 19 s |

Time depends on the data as well as on the numbers of respondents and products and the portfolio size. Most of the time goes to the solve that proves no other portfolio has the same penetration.

## Background

TURF analysis finds the combination of options (for example products or flavors) that reaches the most people. Miaoulis, Free, and Parsons (1990) introduced it as a planning approach for product line extensions. Green and Krieger (1985) studied models and heuristics for product line selection, and Krieger and Green (2000) proposed enhancements to TURF analysis.

Ennis and Fayle (2010) described portfolio optimization based on first choice, and Ennis, Fayle, and Ennis (2012b) gave eTURF, a competitive TURF algorithm for large data sets. They also studied a related covering problem in graph theory, with an exact algorithm for assignment-minimum clique coverings (Ennis, Fayle, and Ennis, 2012a). With Nestrud and Lawless, they validated a graph theoretic screening approach to food item combinations (Nestrud et al., 2011).

Daniel Serra had the key insight that linear programming is well suited to TURF problems. Serra (2013) formulated TURF as a binary linear program and showed that an exact solver finds optimal portfolios efficiently, even for very large problems. This package follows that approach. The maximum reach model has the same structure as the maximal covering location problem of Church and ReVelle (1974). At Procter & Gamble, Camm, Christman, and Narayanan (2022) replaced enumeration with integer programming and cuts to the unit hypercube.

Other work extends TURF with Shapley values (Conklin and Lipovetsky, 2005), latent classes (Lipovetsky, 2008), discrete choice models (Adler, Smith, and Dumont, 2010), and measures of uncertainty (Schramm, Lang, and Lichters, 2026). In R, the turfR package (Horne, 2014) enumerates every combination, with an option to use Monte Carlo samples of combinations. Kuesten and Bi (2021) apply it to CATA data. CRAN removed turfR on 2022-02-04.

## References

Adler, T. J., Smith, C., & Dumont, J. (2010). Optimizing product portfolios using discrete choice modeling and TURF. In S. Hess & A. Daly (Eds.), *Choice modelling: The state-of-the-art and the state-of-practice* (pp. 483-497). Emerald Group Publishing. https://doi.org/10.1108/9781849507738-022

Camm, J. D., Christman, J., & Narayanan, A. (2022). Total unduplicated reach and frequency optimization at Procter & Gamble. *INFORMS Journal on Applied Analytics*, 52(2), 149-157. https://doi.org/10.1287/inte.2021.1096

Church, R., & ReVelle, C. (1974). The maximal covering location problem. *Papers of the Regional Science Association*, 32(1), 101-118. https://doi.org/10.1007/BF01942293

Conklin, W. M., & Lipovetsky, S. (2005). Marketing decision analysis by TURF and Shapley value. *International Journal of Information Technology & Decision Making*, 4(1), 5-19. https://doi.org/10.1142/S0219622005001374

Ennis, J. M., & Fayle, C. M. (2010). Portfolio optimization based on first choice. *IFPress*, 13(2), 2-3.

Ennis, J. M., Fayle, C. M., & Ennis, D. M. (2012a). Assignment-minimum clique coverings. *ACM Journal of Experimental Algorithmics*, 17, Article 1.5. https://doi.org/10.1145/2133803.2275596

Ennis, J. M., Fayle, C. M., & Ennis, D. M. (2012b). eTURF: A competitive TURF algorithm for large datasets. *Food Quality and Preference*, 23(1), 44-48. https://doi.org/10.1016/j.foodqual.2011.06.004

Green, P. E., & Krieger, A. M. (1985). Models and heuristics for product line selection. *Marketing Science*, 4(1), 1-19. https://doi.org/10.1287/mksc.4.1.1

Horne, J. (2014). *turfR: TURF analysis for R* (R package version 0.8-7). https://CRAN.R-project.org/package=turfR

Krieger, A. M., & Green, P. E. (2000). TURF revisited: Enhancements to total unduplicated reach and frequency analysis. *Marketing Research*, 12, 30-36.

Kuesten, C., & Bi, J. (2021). TURF analysis for CATA data using R package 'turfR'. *Food Quality and Preference*, 91, 104201. https://doi.org/10.1016/j.foodqual.2021.104201

Lipovetsky, S. (2008). SURF: Structural unduplicated reach and frequency: Latent class TURF and Shapley value analyses. *International Journal of Information Technology & Decision Making*, 7(2), 203-216. https://doi.org/10.1142/S0219622008002909

Miaoulis, G., Free, V., & Parsons, H. (1990). TURF: A new planning approach for product line extensions. *Marketing Research*, 2(1), 28-40.

Nestrud, M. A., Ennis, J. M., Fayle, C. M., Ennis, D. M., & Lawless, H. T. (2011). Validating a graph theoretic screening approach to food item combinations. *Journal of Sensory Studies*, 26(5), 331-338. https://doi.org/10.1111/j.1745-459X.2011.00348.x

Schramm, J. B., Lang, F. J., & Lichters, M. (2026). BiTURF: Quantifying uncertainty to enhance strategic decision-making. *Food Quality and Preference*, 145, 106001. https://doi.org/10.1016/j.foodqual.2026.106001

Serra, D. (2013). Implementing TURF analysis through binary linear programming. *Food Quality and Preference*, 28(1), 382-388. https://doi.org/10.1016/j.foodqual.2012.10.001

BibTeX for these references is in [research/references.bib](research/references.bib). [research/verification-notes.md](research/verification-notes.md) records how each reference was checked.

## History

This package started in 2021 as a prototype script. The package fixes these problems in the prototype:

- All respondent variables were binary, so one solve took about 8 minutes. They are now continuous.
- The reach values after the tie-break stages came from the solver's respondent variables, which are only a lower bound in those stages. They now come from the selected products.
- The solver status was not checked. A failed solve now stops with an error.
- Solutions were read with an exact test (`== 1`), which fails on values such as 0.9999999.
- The penetration stage could be affected by the first lp_solve problem in the solver notes if a product reached exactly one respondent.
- The code ran only for one portfolio size, on simulated data, with no functions.

## License

The code is under the MIT license. See [LICENSE.md](LICENSE.md). The `ham`, `pies`, and `lunchbags` data sets are under CC BY 4.0, and `coffee` is under CC0 1.0. [inst/COPYRIGHTS](inst/COPYRIGHTS) gives the details.

## Citation

```r
citation("turfLP")
```
