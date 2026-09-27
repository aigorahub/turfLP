# turfLP 0.1.0

First release. The package replaces the 2021 prototype script.

- The repository also contains Python (`python/`) and JavaScript (`js/`) ports that follow the same specification (`docs/algorithm.md`) and pass the same conformance suite (`conformance/`). They are not part of the R package.
- The integer programs are solved with HiGHS (the highs package). Reach and frequency are fixed with exact bounds, and the penetration stage is decided in R, so the tie-breaks are exact up to double-precision rounding.

- `turf()` finds the portfolio of a given size with maximum reach, with frequency and penetration tie-breaks.
- `turf_min_cover()` finds the smallest portfolio that reaches every reachable respondent.
- `turf_sizes()` solves a range of portfolio sizes and returns a table.
- `turf_simulate()` makes random reach data for examples and tests.
- Example data from public studies: `ham`, `coffee`, `pies`, and `lunchbags`. Simulated example data of three sizes: `icecream`, `chips`, and `cafe`.
