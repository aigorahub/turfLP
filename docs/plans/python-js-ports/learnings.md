# Learnings: turfLP Python and JavaScript ports

- HiGHS 1.14 (bundled by the R `highs` package 1.14.0-2) presolve returns a wrong optimum on a 7 by 4 reach matrix (`set.seed(18)` case in `tests/testthat/test-turf.R`). HiGHS 1.15.1 (`highspy`) and 1.15.3 (`highs` on npm) solve it correctly with presolve on. Evidence: session of 2026-09-26, scratch tests `bug.py` and `hjs/t.mjs`.
- lp_solve 5.5 reported points that broke a constraint by 1 as optimal after many added no-good constraints. Any solver result used for a cut must be checked for exactly `size` selected products. Evidence: PR #1 review rounds.
- Near-tie penetration values need decisions in the host language, not in the solver: solver tolerances are about 1e-9, while real penetration differences can be 1e-13. Evidence: PR #1 review rounds.
