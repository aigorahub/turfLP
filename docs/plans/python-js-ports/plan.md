# Plan: Python and JavaScript ports of turfLP

## Mission

Add Python and JavaScript/TypeScript implementations of the turfLP TURF tools (`turf`, `turf_min_cover`, `turf_sizes`) beside the R package in this repository. All three implementations use the HiGHS solver with the same algorithm, solver settings (one named exception: presolve), limits, comparison rule, and warning texts, and all three pass one shared, language-neutral conformance suite whose expected values come from exact brute-force enumeration, not from any of the three solvers. Done means: a Python developer can install `./python` and a Node.js developer can install the packed `./js` package and get the same objective values as the R package on every conformance case, with CI proving it on every push and pull request.

The main JavaScript target is a full-stack Next.js app on Vercel Pro (Node.js runtime), with problems usually under 200 respondents, and Inngest for long runs. This run proves the Next.js path with a traced production build that runs outside the source checkout. An actual Vercel deployment stays a manual check for the user (it needs the user's Vercel project).

## Plan review

Four agents reviewed the first version of this plan (commit `b153c51`): turflp-astra, turflp-agy, turflp-fugu, and turflp-grok. This version resolves their blocking findings: explicit solver settings instead of HiGHS defaults, a pass rule that accepts every correct result, `turf_sizes` and bounded-run fixtures, portable fixture inputs, a specified public API, the synchronous solve in JavaScript, a traced Next.js production test, license files in the npm package, and build hygiene from the first batch. The review files are listed in the execution log.

## Design decisions (settled at planning)

These decisions came from the planning discussion with the user on 2026-09-26 and the plan review. Workers must not reopen them.

1. **One repository.** The R package stays at the repository root, so that CRAN and `remotes::install_github("aigorahub/turfLP")` keep working. New top-level folders: `python/` (PyPI package `turflp`), `js/` (npm package `turflp`, TypeScript), `conformance/` (spec of the fixtures, inputs, generator, fixtures, runners), and `docs/`. `.Rbuildignore` excludes all of them from the R build, and `.gitignore` covers their build artifacts, from B1 on. B1 owns both ignore files; a later batch that needs a new entry records it in the execution log.
2. **HiGHS everywhere.** Python uses `highspy` (official bindings) and builds the model through its structured API. JavaScript uses the npm package `highs` (HiGHS compiled to WebAssembly) and its structured `createModel()` / `passModel()` API, not LP text. The npm package version is not the HiGHS version: `highs@1.15.3` embeds HiGHS 1.15.1. Both ports record the package version and the embedded HiGHS version in their test output. The R package keeps the `highs` R package (HiGHS 1.14).
3. **Explicit solver settings.** Every implementation sets `mip_rel_gap = 0`, `mip_abs_gap = 0`, `primal_feasibility_tolerance = 1e-9`, `mip_feasibility_tolerance = 1e-9`, and one thread. HiGHS defaults are not used for any of these. Success is read from the model status (optimal, infeasible, time limit), never from the return code of the call.
4. **Presolve is the one named difference.** HiGHS 1.14 presolve returned a wrong optimum on a 7 by 4 matrix, so R runs with presolve off. HiGHS 1.15.1 (both ports) solved that matrix and 298 further random reach models correctly with presolve on and the settings in point 3 (checked by turflp-astra on 2026-09-26). The ports run with presolve on. Each port's test suite runs the full conformance suite with presolve on and again with presolve off (an internal test setting), and any difference between the two is a readiness blocker, not a reason to weaken the fixtures.
5. **Same algorithm.** The ports copy the R algorithm exactly, as `docs/algorithm.md` states it: the reach model with continuous `z`, exact whole-number bounds for reach and frequency, the checks on each solver result (exactly `size` products, values near 0 or 1), cut-and-retry on any result that is worse on an earlier criterion, the penetration pool decided in the host language, the solver fallback for a later frequency stage after an incomplete pool, symmetry rows for identical columns, the 100-solve limit per `next_valid` call, the 1000-portfolio pool limit, and the two 30-second budgets (one shared by the pool, one for the later frequency fallback). The reach stage, a frequency stage before penetration, and the first penetration solve have no time limit, as in R. Deadlines use a monotonic clock.
6. **Same comparison rule.** Values count as equal when they differ by at most `16 * size * machine epsilon * max(1, |value|)`, in all three languages. Python and JavaScript could compare exactly, but the same rule keeps the three implementations in agreement.
7. **Conformance pass rule.** A `turf` result passes when it selects `size` distinct products, every reported field equals its recomputation from the returned indices, and the ordered values of reach and the requested tie-break criteria equal the enumerated lexicographic optimum. Criteria that the call did not request are recomputed but not compared with an optimum. A `turf_min_cover` result passes when it covers every reachable respondent and its size equals the enumerated minimum. A `turf_sizes` result passes when its rows follow the requested sizes and each row passes the `turf` rule. Bounded fixtures (forced pool or time limits) check the warning texts, a valid selection, and the preserved earlier criteria, not a later optimum.
8. **Exact expected values from portable inputs.** Matrices that only R can make (R random seeds, package data) are frozen by `conformance/export_r.R` into `conformance/inputs/*.json` (hex-encoded columns) and `conformance/data/*.csv`, and committed. The stdlib-only generator `conformance/generate.py` reads those files, never R or the network, checks their dimensions, names, and SHA-256 digests against `conformance/manifest.json`, enumerates every portfolio, and compares penetration with `fractions.Fraction`. Fixtures store penetration as an exact fraction and as a double. The generator rejects a case when, after the earlier criteria are fixed, the best exact penetration and the nearest distinct eligible penetration differ by more than 0 but not more than the tolerance in point 6; the comparison rule itself is tested separately with values below, at, and above the threshold.
9. **Public API.** Signatures and result types are fixed in `docs/algorithm.md` section 15 before B2 starts. Python uses snake_case (`reach_prop`), TypeScript uses camelCase (`reachProp`). Both return 0-based product indices of the original input columns; R stays 1-based. Both take optional product names and the limit settings.
10. **Warnings.** Python emits `turflp.TurfWarning` (a `UserWarning` subclass) with the R texts. JavaScript returns the texts in a `warnings: string[]` field on each result and never logs to the console.
11. **JavaScript is async to load, synchronous to solve.** Loading the WebAssembly module is async and cached per process; a failed load clears the cache so the next call retries. `highs` solves synchronously and blocks the JavaScript thread, so the async API does not make a solve cancellable. The JavaScript README gives a measured admission rule for which problems to solve in a request and which to send to a background job (Inngest).
12. **Browser support is not promised in this run.** The package targets Node.js 20 and later. Browser use is out of scope.
13. **No publishing.** This run does not publish to PyPI or npm. It prepares the package metadata and license files only.

## Scope

### In Scope
- `docs/algorithm.md`: normative algorithm and public API specification for all implementations.
- `conformance/`: fixture schema and pass rule, frozen inputs with a manifest, stdlib-only generator and its self-test, fixtures, R runner, and a coverage manifest.
- `python/`: package `turflp` with `turf`, `turf_min_cover`, `turf_sizes`, `Portfolio`, `TurfWarning`, input validation, the seven example data sets with license notices, and a pytest suite with conformance and ported regression tests.
- `js/`: npm package `turflp` in TypeScript with `loadSolver`, `turf`, `turfMinCover`, `turfSizes`, the `Portfolio` type, input validation, the seven example data sets in a separate entry point with license notices, a vitest suite with conformance and ported regression tests, and a Next.js route-handler example with a traced production test.
- GitHub Actions workflows for the Python and JavaScript packages, the Next.js example, and the R conformance runner.
- README updates, NEWS, `.Rbuildignore`, `.gitignore`.

### Out of Scope
- Any change to the R algorithm or R API. R files change only for `.Rbuildignore`, `.gitignore`, README, NEWS, and `inst/WORDLIST`.
- Publishing to PyPI or npm, or registering package names.
- `turf_simulate()` ports (the R random number generator cannot be matched across languages).
- A Vercel deployment, Inngest functions, or an Aigora application. The example shows the pattern only.
- Browser and Edge runtime support, Web Worker wrappers, and a CLI.
- Changing the R package's presolve setting (that waits for the R `highs` package to move to HiGHS 1.15).
- A solution check in R's `turf_min_cover()` (the ports add one; an R change would be an R behavior change and is filed as an issue instead).

## Batches

### Batch 1 [B1]: Algorithm spec and conformance suite

- **Intent / why:** Three implementations stay in agreement only if one written spec and one shared test suite bind them. The expected values must come from exact enumeration so that no solver grades itself.
- **Non-obvious rationale:** Inputs that depend on R are frozen once and committed with digests, so the Python generator reproduces the fixtures without R. Large reviewer counterexamples are stored as hex columns (about 700 KB for all inputs). Enumeration is limited to sizes where C(m, k) stays small.
- **Build On targets:** `R/turf.R` (reference behavior), `tests/testthat/test-turf.R` (regression cases), `inst/COPYRIGHTS`, package data.
- **Owned surfaces:** `docs/algorithm.md`, `conformance/**`, `.Rbuildignore`, `.gitignore`.
- **Forbidden surfaces:** `R/**`, `man/**`, `tests/testthat/**`, `data/**`, `DESCRIPTION`.
- **Failure modes / pitfalls:** a generator bug would make all three suites wrong in the same way, so the generator has its own hand-checked self-test; JSON cannot hold exact fractions, so they are strings; the R runner must not depend on files inside the R build.
- **HEAD / run-doc paths / route-session identity / output format:** host-native; run documents in `docs/plans/python-js-ports/`.

**Tasks:**
- [ ] Write `docs/algorithm.md`: inputs and errors, model, criteria, comparison rule, stage loop, cut-and-retry, penetration pool, results, warnings, minimum cover, sizes, solver settings, clocks, limits, and the public API for all three languages.
- [ ] Write `conformance/export_r.R`, freeze the inputs and data, and write `conformance/manifest.json` with digests and a coverage list (each recipe, its source, and any exclusion with its reason).
- [ ] Write `conformance/generate.py` (stdlib only), its self-test, and `conformance/README.md` with the fixture schema and pass rule.
- [ ] Generate fixtures of three kinds: exact (`turf`, `turf_min_cover`, `turf_sizes`), comparator (tolerance rule below, at, and above the threshold), and bounded (forced pool and time limits with expected warning texts).
- [ ] Write `conformance/run_r.R` and run it against the R package.
- [ ] Add the new folders and their build artifacts to `.Rbuildignore` and `.gitignore`.

**Acceptance criteria:**
- [ ] B1-A1: `docs/algorithm.md` specifies inputs and error texts, the model, every stage, cut-and-retry, the penetration pool, the comparison rule, limits and their scopes, monotonic deadlines, explicit solver settings with presolve as the one named difference, warning texts, result fields, and the public Python and TypeScript API, and each algorithm rule names the R function it mirrors.
- [ ] B1-A2: `python3 conformance/generate.py --check` verifies the input digests, regenerates every fixture byte for byte, and exits 0, and `python3 conformance/test_generate.py` passes its hand-checked cases.
- [ ] B1-A3: The exact fixtures cover at least 150 `turf` cases (reach only, each single criterion, and both orders), at least 40 `turf_min_cover` cases, and at least 10 `turf_sizes` cases (default sizes, explicit order, repeated sizes); they include the 7 by 4 presolve matrix, the status-5 permutation, the window case, the 402-column tie flood, the 80 by 202 run-time case, the 35,043, 40,000, 42,000, 15,000, and 60,000 respondent near-tie cases, identical columns, empty rows and columns, `diag(100)` and `diag(101)`, and all seven package data sets (sizes 1 to 3 for `cafe`, `chips`, and `coffee`; every size for the others).
- [ ] B1-A4: `conformance/manifest.json` lists every input with its SHA-256 digest and source, and lists each excluded case with its reason (the 2,600 by 202 run-time cases are excluded because their results depend on machine speed).
- [ ] B1-A5: `Rscript conformance/run_r.R` passes every exact, comparator, and bounded fixture against the R package.
- [ ] B1-A6: The built R tarball contains none of `docs/`, `conformance/`, `python/`, `js/`, or the run documents (checked by listing the tarball with placeholder files present in `python/` and `js/`), and `R CMD check --as-cran` gives only the new-submission NOTE.

**Docs likely touched:** `docs/algorithm.md`, `conformance/README.md`.

**Risk:** `standard` — a wrong expected value in the generator would make all three suites wrong in the same way.
**Caution:** never generate expected values from a solver; keep near-ties below the tolerance out of the exact fixtures.
**Affected surfaces:** `docs/`, `conformance/`, `.Rbuildignore`, `.gitignore`.
**Constitution impacts:** none.
**Review focus:** the generator's lexicographic comparison and exclusion rule; the spec against `R/turf.R`.
**Focused tests:** generator self-test; R runner; tarball listing.
**Depends on:** none.

---

### Batch 2 [B2]: Python package

- **Intent / why:** Python users need the same tool, and `highspy` is the official HiGHS binding, so this port is the easiest to check against R.
- **Non-obvious rationale:** No pandas dependency: accept nested lists, NumPy arrays, and any object with `to_numpy()` and `columns`. Limits are keyword arguments so tests can reach the pool and time-limit paths, as the R options do.
- **Build On targets:** `docs/algorithm.md`, `conformance/`.
- **Owned surfaces:** `python/**`.
- **Forbidden surfaces:** everything outside `python/`, except execution-log entries.
- **Failure modes / pitfalls:** `highspy` status and option names; model rows added between solves must match the spec's row order; warnings must not be emitted twice.

**Tasks:**
- [ ] Package with `pyproject.toml` (Python 3.10 or later; `highspy>=1.15.1,<1.16`; `numpy`; pandas only in a `test` extra), MIT license, `COPYRIGHTS` for the data, and a lock file for CI.
- [ ] `turf`, `turf_min_cover`, `turf_sizes`, `Portfolio`, `TurfWarning`, input validation, and `turflp.datasets.load`.
- [ ] Conformance runner (exact, comparator, bounded) run with presolve on and off.
- [ ] Ported regression tests from `tests/testthat/test-turf.R`, using the frozen inputs for R-seeded matrices.

**Acceptance criteria:**
- [ ] B2-A1: `pytest python` passes, including every exact, comparator, and bounded conformance fixture with presolve on and again with presolve off, with no unexpected warning.
- [ ] B2-A2: The Python suite has a test for each applicable case in `tests/testthat/test-turf.R` (every test except the `turf_simulate()` argument test and the R `print()` test), including the near-tie cases, the 402-column tie flood, `diag(101)`, the pool limit, and the zero time limit.
- [ ] B2-A3: Inputs as nested lists, NumPy integer or boolean arrays, and pandas data frames give the same result, and invalid inputs raise `ValueError` or `TypeError` with the texts in `docs/algorithm.md`.
- [ ] B2-A4: `turflp.datasets.load` returns all seven data sets with the R dimensions, column names, and values.
- [ ] B2-A5: The built wheel and sdist contain the data, `LICENSE`, and `COPYRIGHTS`, and a clean virtual environment that installs the wheel can solve the tie matrix and load a data set.
- [ ] B2-A6: Tests check the effective solver settings of every solve (gaps 0, tolerances 1e-9, one thread, presolve as configured) and the timeout, infeasible, invalid-vector, and retry-limit paths.

**Docs likely touched:** `python/README.md`.

**Risk:** `standard` — `highspy` details differ from the R `highs` wrapper.
**Caution:** keep the stage and pool logic comparable line by line with `R/turf.R`.
**Affected surfaces:** `python/`.
**Constitution impacts:** none.
**Review focus:** parity with `R/turf.R` in the stage loop, the pool, and warnings.
**Focused tests:** conformance runner and ported regression tests.
**Depends on:** B1.

---

### Batch 3 [B3]: JavaScript and TypeScript package

- **Intent / why:** Aigora's web apps are Next.js on Vercel, and most of their TURF problems are small enough to solve inside a request.
- **Non-obvious rationale:** The structured `createModel()` / `passModel()` API avoids LP text and its identifier and precision problems. Persistent models hold WebAssembly memory until disposed, so every model is disposed in a `finally` block or through `withModel`. The solve blocks the thread; the README gives a measured admission rule.
- **Build On targets:** `docs/algorithm.md`, `conformance/`.
- **Owned surfaces:** `js/**`.
- **Forbidden surfaces:** everything outside `js/`, except execution-log entries.
- **Failure modes / pitfalls:** `.wasm` asset resolution in bundlers (`locateFile`, `serverExternalPackages`); concurrent first calls to `loadSolver`; memory leaks from undisposed models.

**Tasks:**
- [ ] Package: `package.json` (ESM, `exports` with `.` and `./datasets`, `types`, `files`, `engines.node >=20`, `highs` `>=1.15.3 <1.16`), `tsconfig.json`, `tsc` build, `vitest`, lock file, MIT `LICENSE`, and `COPYRIGHTS` for the data.
- [ ] `loadSolver`, `turf`, `turfMinCover`, `turfSizes`, `Portfolio`, input validation, warnings.
- [ ] Conformance runner (exact, comparator, bounded) run with presolve on and off.
- [ ] Ported regression tests from `tests/testthat/test-turf.R`, using the frozen inputs.
- [ ] `js/examples/nextjs/`: a route handler with `export const runtime = "nodejs"` and a `maxDuration` above the pool budget, `serverExternalPackages`, installed from the packed tarball, and a script that builds it with `output: "standalone"`, copies the traced output to a temporary folder outside the checkout, starts it, and checks a fixed benchmark request.
- [ ] Benchmark: cold load and warm solves for fixed inputs (200 x 20 at size 5, 200 x 40 at size 8, and the 402-column tie case), recorded in the README with the machine.

**Acceptance criteria:**
- [ ] B3-A1: `npm test` in `js/` passes, including every exact, comparator, and bounded conformance fixture with presolve on and again with presolve off.
- [ ] B3-A2: The JavaScript suite has a test for each applicable case in `tests/testthat/test-turf.R`, as in B2-A2.
- [ ] B3-A3: `npm run build` produces ESM output with type declarations, the packed tarball contains `dist/`, `LICENSE`, `COPYRIGHTS`, and the data entry point, and a clean Node.js project that installs the tarball can solve the tie matrix and load a data set.
- [ ] B3-A4: The main entry point does not import the data sets, `turflp/datasets` returns all seven data sets with the R dimensions, names, and values, and repeated and concurrent calls to `turf` and `loadSolver` give independent correct results with no model left undisposed.
- [ ] B3-A5: The Next.js example's traced standalone output, copied outside the checkout and started with `node server.js`, answers the fixed 200 x 20 size-5 benchmark request with the expected reach, frequency, and penetration, and loads `highs.wasm` from the traced output; a vitest timing test solves the same fixed benchmark from a warm solver in under 5 seconds.
- [ ] B3-A6: Tests check the effective solver settings of every solve and the timeout, infeasible, invalid-vector, and retry-limit paths, as in B2-A6.

**Docs likely touched:** `js/README.md`, `js/examples/nextjs/README.md`.

**Risk:** `high` — WebAssembly loading inside Next.js file tracing is the least-proven part of the plan.
**Caution:** keep the route on the Node.js runtime; keep the example out of the npm package files.
**Affected surfaces:** `js/`.
**Constitution impacts:** none.
**Review focus:** model building and disposal, parity with `R/turf.R`, solver loading and caching, the traced Next.js test.
**Focused tests:** conformance runner, ported regression tests, packed-tarball smoke test, Next.js standalone test.
**Depends on:** B1.

---

### Batch 4 [B4]: CI, documentation, and release metadata

- **Intent / why:** Agreement between the three implementations must be enforced on every push and pull request, and users must be able to find and use the ports.
- **Non-obvious rationale:** Each language's suite reads the shared fixtures from `conformance/`, so one fixture change tests all three.
- **Build On targets:** `.github/workflows/R-CMD-check.yaml`, the root README.
- **Owned surfaces:** `.github/workflows/**`, `README.md`, `NEWS.md`, `inst/WORDLIST`, `python/README.md`, `js/README.md`, `js/examples/nextjs/README.md`.
- **Forbidden surfaces:** `R/**`, `man/**`, `tests/testthat/**`, `data/**`.
- **Failure modes / pitfalls:** Windows paths in the fixture loaders; dependency caches; the R workflow must not start running the other suites.

**Tasks:**
- [ ] Workflow `python.yaml` (push and pull request): Ubuntu, macOS, and Windows with Python 3.10 and 3.13, from the lock file, plus one job at the minimum supported `highspy`.
- [ ] Workflow `js.yaml` (push and pull request): Ubuntu, macOS, and Windows with Node.js 20 and 22, from the lock file, plus the Next.js standalone test on Ubuntu.
- [ ] Workflow `conformance-r.yaml` (push and pull request): `conformance/generate.py --check` and `conformance/run_r.R`.
- [ ] Root README section on the three implementations; package READMEs; NEWS entry; file the R `turf_min_cover()` check issue.

**Acceptance criteria:**
- [ ] B4-A1: The three new workflows and the existing R workflow pass on the final pull request head.
- [ ] B4-A2: The root README describes the three implementations, the shared conformance suite, and how to install each package from the repository.
- [ ] B4-A3: `python/README.md` and `js/README.md` each show installation, a working example whose output matches the code, the limits and warnings, and the differences from R; the JavaScript README covers Next.js on Vercel (Node.js runtime, `serverExternalPackages`, solver reuse, the synchronous solve, the measured admission rule, and when to use a background job).
- [ ] B4-A4: The R package check still gives only the new-submission NOTE, and the R spelling check passes.

**Docs likely touched:** `README.md`, `NEWS.md`, `python/README.md`, `js/README.md`.

**Risk:** `low` — workflow and documentation work.
**Caution:** do not publish packages; do not change R behavior.
**Affected surfaces:** `.github/workflows/`, READMEs, `NEWS.md`.
**Constitution impacts:** none.
**Review focus:** README examples match real output; workflows test what they claim.
**Focused tests:** the workflows themselves.
**Depends on:** B2, B3.

---

## Master Acceptance

- [ ] M-A1: On the final pull request head, the R, Python, and JavaScript implementations all pass the full shared conformance suite in CI.
- [ ] M-A2: The R package behavior is unchanged: its tests pass and `R CMD check --as-cran` gives only the new-submission NOTE.
- [ ] M-A3: `docs/algorithm.md`, `conformance/README.md`, the root README, and both package READMEs are current with the final code.
- [ ] M-A4: Final reviews of the cumulative diff by turflp-astra, turflp-grok, turflp-agy, and turflp-fugu report no unresolved blocking finding.

---

## Non-Negotiables

- Do not change R algorithm behavior or the R API.
- Expected conformance values come from exact enumeration, never from a solver.
- All three implementations use the same algorithm, solver settings (except the named presolve difference), limits, comparison rule, and warning texts.
- Do not publish to PyPI or npm.
- No AI attribution in commits, PRs, or code.
- The user authorized landing for this run after all four agents are satisfied: land with a regular merge commit (never a squash) only after final readiness.
