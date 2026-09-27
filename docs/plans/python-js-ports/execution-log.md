# Execution log: turfLP Python and JavaScript ports

## 2026-09-26 21:53 EDT staging

- Created worktree `/Users/john/aigora/dev/turfLP-python-js-ports` on `feat/python-js-ports` from `origin/main` at `ebea497080b292cc31e50d7450b92f06b6855ba2`.
- Wrote the plan, survival guide, learnings, and this log.
- Checked toolchains: Python 3.14.7, Node.js 26.3.0, npm 11.16.0, uv available; highspy 1.15.1 and highs-js 1.15.3 solve the 7 by 4 presolve matrix correctly with presolve on; highs-js solves 200 x 20 (k = 5) in about 0.35 s and 500 x 40 (k = 8) in about 2.6 s per reach solve.

## 2026-09-26 22:10 EDT plan review and revision

- Opened draft PR #2 at the staging commit `b153c51`.
- Plan reviews: `/private/tmp/claude-501/-Users-john-aigora-dev-turfLP/ea7aeaf6-8fd0-4818-85ee-d90f3bf01469/scratchpad/reviews/plan-turflp-astra.md` (3 blocking, 5 advisory), `plan-turflp-agy.md` (7 blocking, 4 advisory), `plan-turflp-fugu.md` (7 blocking, 3 advisory), `plan-turflp-grok.md` (2 blocking, 5 advisory).
- Shared blocking findings and resolutions: HiGHS defaults differ from R (gaps 1e-4 and 1e-6, feasibility 1e-7 and 1e-6), so the plan now sets explicit settings with presolve as the one named difference and a presolve-on/off differential run; the pass rule now compares only reach and the requested criteria, has separate minimum-cover, sizes, and bounded classes; inputs are frozen from R with digests; the public API is specified in `docs/algorithm.md` section 15; the JavaScript solve is documented as synchronous; the Next.js proof is a traced standalone build run outside the checkout; the npm package gets LICENSE and COPYRIGHTS; `.Rbuildignore` and `.gitignore` cover the new folders from B1.
- Added acceptance ids B1-A6, B2-A6, B3-A6 and reworded existing criteria (no evidence existed yet).
- Deviation noted: an actual Vercel deployment stays a manual user check (needs the user's Vercel project); browser support is out of scope.

## 2026-09-26 22:20 EDT delta plan review and B1

- Delta plan reviews (`/private/tmp/claude-501/-Users-john-aigora-dev-turfLP/ea7aeaf6-8fd0-4818-85ee-d90f3bf01469/scratchpad/reviews/plan2-*.md`): all four agents confirm their blocking findings resolved. New points applied: exact fixtures run with no pool time limit (Fugu); JavaScript does not set threads because `createModel()` rejects thread options (Grok); presolve on/off runs must each pass the pass rule, not return identical portfolios (Grok); the plan names the penetration comparison method (Grok).
- B1: `docs/algorithm.md`; `conformance/export_r.R` froze 93 R inputs and 7 data CSVs; `conformance/generate.py` wrote 4 generated inputs and fixtures (turf 1625, min_cover 82, sizes 12, bounded 5, comparator 40) in 0.2 s; `test_generate.py` 12 tests OK; `run_r.R` passes all fixtures in about 76 s.
- Fixed during B1: `diag(100)` at size 2 has 4950 exact ties and correctly hits the 1000-portfolio pool limit, so it moved out of the exact fixtures; a worktree `.git` file entered the R tarball, so `.Rbuildignore` gained `^\.git$`.
- Evidence recorded in `.elves-session.json` for B1-A1 to B1-A6.

## 2026-09-26 22:31 EDT B2 Python package

- `python/`: package `turflp` 0.1.0 on highspy 1.15.1 (HiGHS 1.15.1) and NumPy; model passed to HiGHS as a row-wise `HighsLp` per solve, as R rebuilds its model per solve.
- Found during B2: `highspy` 1.15 `getOptionValue` returns (status, value); with presolve on, HiGHS can report "unbounded or infeasible" for an infeasible model, so the port treats it as infeasible (spec section 6 updated).
- `pytest`: 3557 passed in 164 s. Wheel and sdist contain data, LICENSE, COPYRIGHTS; clean Python 3.10 install works. `uv.lock` added for CI.
- User instruction: leave turflp-grok out of the rest of the session. M-A4 now names turflp-astra, turflp-agy, and turflp-fugu.

## 2026-09-26 23:16 EDT B3 JavaScript package

- `js/`: npm package `turflp` 0.1.0 on `highs` 1.15.3 (HiGHS 1.15.1, git 04024d7) through `createModel()` / `passModel()`; every model disposed in `finally`.
- Found during B3: `highs` declares CommonJS but ships ESM, so TypeScript under NodeNext needs a loader shim; `createModel()` rejects `threads`; Vitest's 60 s worker RPC timeout fired while synchronous solves held workers under heavy machine load, fixed with the `forks` pool, per-input test groups, and a yield between cases; Node's `cpSync` rewrote Turbopack's relative `.next/node_modules/turflp-<hash>` symlink, fixed with `verbatimSymlinks`.
- Added conformance inputs `gen-bench-200x20` (fixtures at sizes 3 and 5) and `gen-bench-200x40` (timing only); Python bench cases pass.
- Benchmark (`node scripts/benchmark.mjs`, Apple M5 Pro, Node.js 26.3.0, machine heavily loaded by other work): cold solver load 13 ms; 200 x 20 size 5: 450 ms; 200 x 40 size 8: 82 ms; 16 x 402 tie flood, penetration first: 9.4 s.
- User instruction: leave turflp-fugu out of the rest of the session. M-A4 now names turflp-astra and turflp-agy.

## 2026-09-26 23:50 EDT B4 CI and documentation

- Workflows `python.yaml`, `js.yaml`, `conformance-r.yaml`; root README section and badges; `python/README.md`, `js/README.md`, `js/examples/nextjs/README.md`; NEWS; `inst/WORDLIST` (+6 words).
- First CI run: `js.yaml` failed on 5 of 6 test jobs with Vitest's fixed 60 s worker message timeout (synchronous solves on the 40,000-respondent inputs). Fix: the conformance fixtures and large regression cases run in `js/scripts/conformance.mjs` against the built package (like the R runner); Vitest keeps 70 fast unit tests.
- All four workflows pass on a200d40 (push and pull_request). Local: R runner passes all fixtures; R CMD check 1 NOTE; tarball excludes the new folders.
- Filed issue #3 (R `turf_min_cover()` does not check the solver's cover; out of scope for this run).

## 2026-09-27 00:17 EDT final review round 1 (turflp-astra, turflp-agy)

- Reviews: `/private/tmp/claude-501/-Users-john-aigora-dev-turfLP/ea7aeaf6-8fd0-4818-85ee-d90f3bf01469/scratchpad/reviews/run-turflp-astra.md` (2 blocking, 4 advisory), `/private/tmp/claude-501/-Users-john-aigora-dev-turfLP/ea7aeaf6-8fd0-4818-85ee-d90f3bf01469/scratchpad/reviews/run-turflp-agy.md` (0 blocking, 4 advisory). Grok and Fugu excluded by the user.
- Fixed (blocking): JavaScript holes in sparse arrays now raise the missing-value error; all three runners now require exactly the requested size of distinct, valid, reaching products, and each runner self-checks that its checker rejects a wrong-size, duplicate-index, or out-of-range result.
- Fixed (advisory): limits validated before any solve in both ports (NaN, negative, wrong type; Infinity allowed for seconds; 0 allowed for the pool); JavaScript `formatG` implements C's `%g` (round half to even) and a new `format.json` fixture (18 cases) is checked in R, Python, and JavaScript; the Python sdist tests collect without `conformance/` (18 passed, 53 skipped when unpacked); `maxDuration` described as an operational ceiling, not a guarantee; JavaScript `TypeError` for wrong-typed `size` and `tiebreak`; GitHub Actions updated (setup-node v7, setup-uv v10, setup-python v7).
- Local: pytest 3585 passed; Vitest 75 passed; JS conformance script passes; R runner passes (turf 1629, min_cover 82, sizes 12, bounded 5, comparator 40, format 18); spelling clean.
