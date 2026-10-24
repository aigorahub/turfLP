# turfLP (development version)

- JavaScript: when `turfFrontier` reaches its time limit during the penetration search of a point, it keeps that point with the best portfolio found and sets `penetrationLimited`. Before, the point was dropped.
- JavaScript: remove the internal `turfPrepared` function, which had no caller after the dashboard moved out. The public API does not change.

# turfLP 0.5.0

- JavaScript 0.5.0: add public `turfBaselines` and `turfFrontier` APIs for greedy/most-popular comparisons and the reach/frequency frontier. Validate inputs and report partial search status. R and Python have no API changes; their version follows the shared release.

- Documentation: add usage and development guides, explain result fields and search limits, expand R function help, and document exact-version installation and the Next.js example setup.

- Browser application: move the application to a separate private repository and host it at https://turf.aigora.ai. Remove `dashboard/` and its CI job from this repository. Keep solver regression tests in the JavaScript package. The application retains its CSV input, charts, deep dive, and fixed-product controls. Existing standalone HTML release artifacts remain available in the release history.

# turfLP 0.4.0

- `turf_sizes()` checks `tiebreak` before `fixed`, and also when `sizes` is empty, as `turf()` and the Python and JavaScript ports do.
- JavaScript: `turf()`, `turfMinCover()`, and `turfSizes()` solve an equivalent smaller model (`docs/algorithm.md` section 3). Respondents that a fixed product reaches leave the model, and when many respondents give the same answers, each set of equal answers is one weighted row. Data with many identical respondents solves much faster: a 2,000 by 25 case of size 3 took 12 ms instead of 0.54 s, and the 42,000-respondent regression case took 9 ms instead of 2.3 s. Other data solves as before. The optima are the same; when several portfolios are optimal, a different one can be returned.
- JavaScript: a stage is not solved when a portfolio meets a proved bound: a greedy portfolio that reaches every reachable respondent, or a portfolio whose frequency is the largest possible (`docs/algorithm.md` section 7).
- JavaScript: the data of a `turfSizes()` call is prepared once for every size.
- The Next.js example solves in a worker thread, one solve at a time per instance with up to 4 waiting, and stops a request at a 50-second deadline (HTTP 504). It forwards `fixed`, answers 400, 413, 503, and 500 as its README states, and caches complete results. It needs Next.js 16.4.2 or later.
- The dashboard uses the same smaller model, and prepares the data once per run.
- Dashboard: the fixed-product list sorts by name or by reach. A change to the fixed products no longer stops a run in progress. With 8 or more fixed products, the columns show them as one segment, so the other products keep their own colors.

# turfLP 0.3.0

- `turf()`, `turf_min_cover()`, and `turf_sizes()` take `fixed`: column indices of products that the portfolio must contain. `size` counts them, and the stages choose the other products. The default sizes of `turf_sizes()` start at the number of fixed products. Portfolios have a `fixed` element, and `print()` shows the fixed products.
- The Python and JavaScript ports and the browser dashboard have the same option. The dashboard has a fixed-product list in its settings, and its stage counts, trade-off, charts, and CSV follow the fixed products.

# turfLP 0.2.0

- The integer programs are solved with HiGHS (the highs package) instead of lpSolve, which returned infeasible points as optimal for some inputs. Reach and frequency are fixed with exact bounds, and the penetration stage is decided in R, so the tie-breaks are exact up to double-precision rounding.
- After its first penetration solve, `turf()` searches for other portfolios with the same penetration, within the solver tolerance. That search stops after 1,000 more portfolios or 30 seconds. If it stops early, `turf()` gives a warning, and the penetration is optimal only to within the solver tolerance (about 1e-9).
- `turf_min_cover()` checks the solver's result and stops with an error if the selection does not cover everyone or is not integral.
- `turf_simulate()` checks its arguments.
- The repository also contains Python (`python/`) and JavaScript (`js/`) ports that follow the same specification (`docs/algorithm.md`) and pass the same conformance suite (`conformance/`), and a one-file browser dashboard (`dashboard/`) that runs the JavaScript port. They are not part of the R package.

# turfLP 0.1.0

First release. The package replaces the 2021 prototype script.

- `turf()` finds the portfolio of a given size with maximum reach, with frequency and penetration tie-breaks.
- `turf_min_cover()` finds the smallest portfolio that reaches every reachable respondent.
- `turf_sizes()` solves a range of portfolio sizes and returns a table.
- `turf_simulate()` makes random reach data for examples and tests.
- Example data from public studies: `ham`, `coffee`, `pies`, and `lunchbags`. Simulated example data of three sizes: `icecream`, `chips`, and `cafe`.
