# Plan: Python and JavaScript ports of turfLP

## Mission

Add Python and JavaScript/TypeScript implementations of the turfLP TURF tools (`turf`, `turf_min_cover`, `turf_sizes`) beside the R package in this repository. All three implementations use the HiGHS solver and the same algorithm, limits, tolerance, and warnings, and all three pass one shared, language-neutral conformance suite whose expected values come from exact brute-force enumeration, not from any of the three solvers. Done means: a Python developer can `pip install ./python` and a Next.js developer can install `./js` and get the same reach, frequency, and penetration values as the R package on every conformance case, with CI proving it on every push.

The main JavaScript target is a full-stack Next.js app on Vercel Pro (Node.js runtime), with problems usually under 200 respondents, and Inngest for long runs.

## Design decisions (settled at planning)

These decisions came from the planning discussion with the user on 2026-09-26. Workers must not reopen them.

1. **One repository.** The R package stays at the repository root, so that CRAN and `remotes::install_github("aigorahub/turfLP")` keep working. New top-level folders: `python/` (PyPI package `turflp`), `js/` (npm package `turflp`, TypeScript), `conformance/` (spec, fixtures, generator, runners). All are excluded from the R build in `.Rbuildignore`.
2. **HiGHS everywhere.** Python uses `highspy` (official bindings, minimum 1.15.1). JavaScript uses the npm package `highs` (HiGHS compiled to WebAssembly, minimum 1.15.3). The R package keeps the `highs` R package.
3. **Presolve.** HiGHS 1.14 presolve returned a wrong optimum on a 7 by 4 matrix, so the R package runs with presolve off. HiGHS 1.15.1 (highspy) and 1.15.3 (highs-js) solve that matrix correctly with presolve on (checked on 2026-09-26), so the ports use HiGHS defaults with presolve on. The 7 by 4 matrix is a conformance fixture, and each port's test suite also checks it with reach only.
4. **Same algorithm.** The ports copy the R algorithm exactly: the reach model with continuous `z`, exact whole-number bounds for reach and frequency, cut-and-retry on any solver result that is worse on an earlier criterion, the check that a solver result selects exactly `size` products, the penetration pool bounded by the exact value of the first solution and decided in the host language, the solver fallback for a later frequency stage after an incomplete pool, symmetry constraints for identical columns, and the same limits (100 solves per stage, 1000 pool portfolios, 30 seconds per stage budget). `docs/algorithm.md` states this normatively; the R source is the reference where the spec is silent.
5. **Same tolerance.** Values count as equal when they differ by less than `16 * size * machine epsilon` (relative), in all three languages. Python and JavaScript could compare exactly, but the same rule keeps the three implementations in agreement.
6. **Conformance compares values, not product indices.** Ties are common, and different HiGHS versions can return different optimal portfolios. A result passes when it selects `size` distinct products, its recomputed values equal the reported values, and its reach, frequency, and penetration equal the enumerated lexicographic optimum for the tie-break order.
7. **Exact expected values.** The fixture generator is a stdlib-only Python script that enumerates every portfolio and compares penetration with `fractions.Fraction`. Fixtures store penetration as an exact fraction (numerator and denominator strings) and as a double. Fixtures do not include cases where two distinct optimal penetration values differ by less than the tolerance in point 5; the generator rejects them.
8. **Index base.** Python and JavaScript return 0-based product indices (language convention); R stays 1-based. The fixtures and spec say which base they use.
9. **Warnings.** Python emits `turflp.TurfWarning` (a `UserWarning` subclass) with the same text as R. JavaScript returns the same text in a `warnings: string[]` field on each result and never logs to the console.
10. **JavaScript API is async.** `highs-js` loads WebAssembly asynchronously. The package loads the solver once per process and reuses it. It runs in the Node.js runtime (not the Edge runtime) and in browsers.
11. **No publishing.** This run does not publish to PyPI or npm. It prepares the package metadata only.

## Scope

### In Scope
- `docs/algorithm.md`: the normative algorithm specification shared by all implementations.
- `conformance/`: fixture format specification, stdlib-only Python generator, fixtures, and an R runner.
- `python/`: package `turflp` with `turf`, `turf_min_cover`, `turf_sizes`, the `Portfolio` result type, input validation, warnings, example data sets, pytest suite including conformance.
- `js/`: npm package `turflp` in TypeScript with `turf`, `turfMinCover`, `turfSizes`, `loadSolver`, the `Portfolio` type, input validation, warnings, example data sets, a vitest suite including conformance, and a minimal Next.js route-handler example.
- GitHub Actions workflows for the Python and JavaScript packages and for the R conformance runner.
- README updates (root README section "Python and JavaScript", package READMEs), NEWS, `.Rbuildignore`.

### Out of Scope
- Any change to the R algorithm or R API. R files change only for `.Rbuildignore` and README/NEWS text.
- Publishing to PyPI or npm, or registering package names.
- `turf_simulate()` ports (the R random number generator cannot be matched across languages).
- A Next.js application for Aigora, Inngest functions, or Vercel deployment. The example shows the pattern only.
- Edge runtime support, Web Worker wrappers, and a CLI.
- Changing the R package's presolve setting (that waits for the R `highs` package to move to HiGHS 1.15).

## Batches

### Batch 1 [B1]: Algorithm spec and conformance suite

- **Intent / why:** Three implementations stay in agreement only if one written spec and one shared test suite bind them. The fixtures must come from exact enumeration so that no solver grades itself.
- **Non-obvious rationale:** Expected values come from brute force with exact fractions. Large reviewer counterexamples (up to 60,000 respondents) are stored compactly so the suite stays small. The R runner lives outside the R package build, because `conformance/` is not part of the R package.
- **Build On targets:** `R/turf.R` (the reference behavior), `tests/testthat/test-turf.R` (the regression cases, including every reviewer counterexample), `R/data.R` and `data/` (package data).
- **Owned surfaces:** `docs/algorithm.md`, `conformance/**`, `.Rbuildignore`.
- **Forbidden surfaces:** `R/**`, `man/**`, `tests/testthat/**`, `data/**`, `DESCRIPTION`, run documents other than the execution log entries.
- **Acceptance evidence:** listed below.
- **Failure modes / pitfalls:** enumeration cost grows as C(m, k), so large fixtures use small `k` or few products; a generator bug would poison all three suites, so the generator is itself tested against hand-checked cases; JSON cannot hold exact fractions, so they are strings.
- **HEAD / run-doc paths / route-session identity / output format:** host-native; run documents in `docs/plans/python-js-ports/`.

**Tasks:**
- [ ] Write `docs/algorithm.md`: input rules, model, stages, cut-and-retry, penetration pool, limits, tolerance, warnings, result fields.
- [ ] Write `conformance/README.md` with the fixture schema and the pass rule.
- [ ] Write `conformance/generate.py` (stdlib only) and its self-test.
- [ ] Generate fixtures: small random matrices, the tie matrix, identical columns, empty rows and columns, the 7 by 4 presolve matrix, each reviewer counterexample from `tests/testthat/test-turf.R`, and the seven package data sets at small sizes.
- [ ] Write `conformance/run_r.R` and run it against the R package.

**Acceptance criteria:**
- [ ] B1-A1: `docs/algorithm.md` specifies inputs, the model, every stage, cut-and-retry, the penetration pool, limits, the tolerance rule, warning texts, and result fields, and each rule names the R function it mirrors.
- [ ] B1-A2: `python3 conformance/generate.py --check` regenerates every fixture byte for byte from the committed recipes and exits 0, and the generator self-test passes.
- [ ] B1-A3: The fixtures cover at least 150 `turf` cases and 40 `turf_min_cover` cases, both tie-break orders and each single criterion, the 7 by 4 presolve matrix, every reviewer counterexample from `tests/testthat/test-turf.R`, and all seven package data sets.
- [ ] B1-A4: `Rscript conformance/run_r.R` passes every fixture against the R package.
- [ ] B1-A5: `R CMD check --as-cran` still gives only the new-submission NOTE, which proves that the new folders are excluded from the R build.

**Docs likely touched:** `docs/algorithm.md`, `conformance/README.md`.

**Risk:** `standard` — a wrong expected value in the generator would make all three suites wrong in the same way.
**Caution:** do not generate fixtures from any solver; do not include near-ties below the tolerance.
**Affected surfaces:** `docs/`, `conformance/`, `.Rbuildignore`.
**Constitution impacts:** none.
**Review focus:** correctness of the generator's lexicographic comparison and of the spec against `R/turf.R`.
**Focused tests:** generator self-test; R runner.
**Depends on:** none.

---

### Batch 2 [B2]: Python package

- **Intent / why:** Python users need the same tool, and `highspy` is the official HiGHS binding, so this port is the easiest to test against R.
- **Non-obvious rationale:** No pandas dependency: accept any object with `to_numpy()` and `columns`, plus NumPy arrays and nested lists. Limits are keyword arguments so tests can reach the pool and time-limit paths, as the R options do.
- **Build On targets:** `docs/algorithm.md`, `conformance/`.
- **Owned surfaces:** `python/**`.
- **Forbidden surfaces:** everything outside `python/`, except execution-log entries.
- **Acceptance evidence:** listed below.
- **Failure modes / pitfalls:** `highspy` API differences between versions; floating-point sums must be computed in the same order as the spec states; warnings must not be emitted twice.

**Tasks:**
- [ ] Package skeleton with `pyproject.toml` (Python 3.10 or later, dependencies `highspy>=1.15.1` and `numpy`), MIT license, and `COPYRIGHTS` for the data.
- [ ] `turf`, `turf_min_cover`, `turf_sizes`, `Portfolio`, `TurfWarning`, input validation.
- [ ] Port of every regression test from `tests/testthat/test-turf.R`, plus the conformance runner.
- [ ] Example data sets and `turflp.datasets.load(name)`.

**Acceptance criteria:**
- [ ] B2-A1: `pytest python` passes, including every conformance fixture, with no unexpected warning.
- [ ] B2-A2: The Python suite contains a test for each regression case in `tests/testthat/test-turf.R`, including the 40,000, 35,043, and 42,000 respondent near ties, the 402-column tie flood, `diag(101)`, the pool limits, and the zero time limit.
- [ ] B2-A3: Inputs as nested lists, NumPy integer or boolean arrays, and pandas data frames give the same result, and invalid inputs raise `ValueError` or `TypeError` with the R message texts.
- [ ] B2-A4: `turflp.datasets.load` returns all seven data sets with the R dimensions and values.
- [ ] B2-A5: `python -m build python` produces a wheel and an sdist that install into a clean virtual environment and import.

**Docs likely touched:** `python/README.md`.

**Risk:** `standard` — `highspy` model-building details differ from the R `highs` wrapper.
**Caution:** keep the stage and pool logic line-for-line comparable with `R/turf.R`.
**Affected surfaces:** `python/`.
**Constitution impacts:** none.
**Review focus:** parity with `R/turf.R` in the stage loop, the pool, and warnings.
**Focused tests:** conformance runner and ported regression tests.
**Depends on:** B1.

---

### Batch 3 [B3]: JavaScript and TypeScript package

- **Intent / why:** Aigora's web apps are Next.js on Vercel, and most of their TURF problems are small enough to solve inside a request.
- **Non-obvious rationale:** `highs-js` takes a model in CPLEX LP text format and loads WebAssembly asynchronously, so every entry point is async and the solver is cached per process. Bundlers need a way to locate the `.wasm` file, so `loadSolver` passes options through to the `highs` loader.
- **Build On targets:** `docs/algorithm.md`, `conformance/`, the Python port for structure.
- **Owned surfaces:** `js/**`.
- **Forbidden surfaces:** everything outside `js/`, except execution-log entries.
- **Acceptance evidence:** listed below.
- **Failure modes / pitfalls:** LP text needs full double precision for fractional coefficients (use shortest round-trip formatting); variable names must be valid LP identifiers; `highs-js` returns column values keyed by name.

**Tasks:**
- [ ] Package skeleton: `package.json` (ESM, `types`, `exports`), `tsconfig.json`, build with `tsc`, tests with `vitest`.
- [ ] `loadSolver`, `turf`, `turfMinCover`, `turfSizes`, `Portfolio` type, input validation, warnings.
- [ ] Port of every regression test from `tests/testthat/test-turf.R`, plus the conformance runner.
- [ ] Example data sets as a separate entry point (`turflp/datasets`) so that the main bundle stays small.
- [ ] Minimal Next.js route-handler example in `js/examples/nextjs/`.

**Acceptance criteria:**
- [ ] B3-A1: `npm test` in `js/` passes, including every conformance fixture.
- [ ] B3-A2: The JavaScript suite contains a test for each regression case in `tests/testthat/test-turf.R`, as in B2-A2.
- [ ] B3-A3: `npm run build` produces ESM output with type declarations, and a clean Node.js project can install the packed tarball and solve the tie matrix.
- [ ] B3-A4: The main entry point does not import the data sets, and `turflp/datasets` returns all seven data sets with the R dimensions and values.
- [ ] B3-A5: The Next.js example builds with `next build` and its route handler returns a portfolio for a 200-respondent problem in under 5 seconds with `next start` on the development machine.

**Docs likely touched:** `js/README.md`, `js/examples/nextjs/README.md`.

**Risk:** `high` — WebAssembly loading inside Next.js bundling is the least-proven part of the plan.
**Caution:** keep the Next.js route on the Node.js runtime; do not add the example to the npm package files.
**Affected surfaces:** `js/`.
**Constitution impacts:** none.
**Review focus:** LP text generation (precision, names), parity with `R/turf.R`, async solver reuse.
**Focused tests:** conformance runner, ported regression tests, packed-tarball smoke test.
**Depends on:** B1.

---

### Batch 4 [B4]: CI, documentation, and release metadata

- **Intent / why:** Agreement between the three implementations must be enforced on every push, and users must be able to find and use the ports.
- **Non-obvious rationale:** Each language's suite reads the shared fixtures from `conformance/`, so one fixture change tests all three.
- **Build On targets:** `.github/workflows/R-CMD-check.yaml`, the root README.
- **Owned surfaces:** `.github/workflows/**`, `README.md`, `NEWS.md`, `inst/WORDLIST`, `python/README.md`, `js/README.md`.
- **Forbidden surfaces:** `R/**`, `man/**`, `tests/testthat/**`, `data/**`.
- **Acceptance evidence:** listed below.
- **Failure modes / pitfalls:** Windows paths in the fixture loader; npm cache and pip cache keys; the R workflow must not start running the Python or JavaScript suites.

**Tasks:**
- [ ] Workflow `python.yaml`: Ubuntu, macOS, and Windows with Python 3.10 and 3.13.
- [ ] Workflow `js.yaml`: Ubuntu, macOS, and Windows with Node.js 20 and 22.
- [ ] Workflow `conformance-r.yaml`: runs `conformance/run_r.R` and `conformance/generate.py --check`.
- [ ] Root README section on the Python and JavaScript packages; package READMEs with install, usage, differences from R (0-based indices, async in JavaScript), limits, and warnings; NEWS entry.

**Acceptance criteria:**
- [ ] B4-A1: The three new workflows and the existing R workflow pass on the pull request.
- [ ] B4-A2: The root README describes the three implementations, the shared conformance suite, and how to install each package from the repository.
- [ ] B4-A3: `python/README.md` and `js/README.md` each show installation, a working example whose output matches the code, the limits and warnings, and the differences from R; the JavaScript README covers Next.js on Vercel (Node.js runtime, solver reuse, when to move work to a background job).
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
- All three implementations use the same algorithm, limits, tolerance rule, and warning texts.
- Do not publish to PyPI or npm.
- No AI attribution in commits, PRs, or code.
- The user authorized landing for this run after all four agents are satisfied: land with a regular merge commit (never a squash) only after final readiness.
