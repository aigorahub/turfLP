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
