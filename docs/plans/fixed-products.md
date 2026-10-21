# Plan: fixed products

## Mission

A user can name products that the portfolio must contain ("we must keep
products 1 and 2"), and the R, Python, and JavaScript solvers and the browser
dashboard find the best portfolio that contains them. The design below was
agreed by turf-opus, turf-astra, turf-grok, and turf-agy on 2026-10-21. The
run ends with all docs current, version 0.3.0 in the R, Python, and
JavaScript packages and the dashboard, the PR merged with a merge commit, and
a GitHub release v0.3.0 on the merge commit with the dashboard file attached.

## Scope

### In scope
- `fixed` argument in `turf()`, `turf_min_cover()`, `turf_sizes()` in R,
  Python, and JavaScript, with the `fixed` field in the result.
- `docs/algorithm.md`, the conformance generator, fixtures, and the three
  runners.
- The dashboard (settings, worker, analysis, contributions, results, CSV).
- READMEs, roxygen and `man/`, NEWS, version 0.3.0.

### Out of scope
- CRAN submission of 0.3.0 (John submits).
- Redeploy of turf.aigora.ai (manual; John asks for it).
- Any change to the stages, tie-breaks, pool, limits, or warnings.

## Design (agreed)

### Semantics

- New argument `fixed`: product indices that every returned portfolio must
  contain. R `fixed = NULL` (1-based), Python keyword-only `fixed=()` (0-based,
  after `*` with `names`), JS `options.fixed` (0-based). Same index base as `products` in the result.
- `size` is the total portfolio size, fixed products included.
- Stages, tie-breaks, pool, limits, and warnings do not change. The optimum is
  over portfolios that contain every fixed product.
- Duplicates in `fixed` are removed (as `tiebreak` does). Order does not matter.
- `size == length(fixed)` is valid: the result is the fixed products.

### Model change (docs/algorithm.md section 3)

1. One row: `Σ_{j∈F} x_j = |F|`, over the candidate positions of F. No row
   when F is empty. With `x_j ≤ 1` this forces each fixed
   `x_j = 1`, also in the LP relaxation. A row (not a variable bound) keeps
   `solve_lp` / `solver.solve` unchanged in all three ports.
2. Symmetry rows: build the chains of identical columns over the free
   candidates only. Today a fixed product that is the later twin of a free
   product gives the row `x_j' − x_j ≥ 0`, which forces the free twin into the
   portfolio too (wrong result, or infeasible when size is tight). Fixed
   products take no part in symmetry rows, and a fixed column is never the
   "latest earlier twin" that a later free column links to.
3. Post-solve validation (section 6 step 4 and section 11) also requires
   every fixed candidate to be selected; otherwise it is an invalid solution
   (error in the first stage, status `invalid` later), as for a wrong count.
4. Nothing else changes: candidates, model respondents, `c_j`, bound rows,
   no-good cuts `Σ_{j∈sel} x_j ≤ size − 1`, tolerances (full `size`, full
   values). All values are computed from the full selection, fixed included.

### Validation (section 1 table, exact messages, in this order after `size`)

| Condition | Message |
|---|---|
| `fixed` not a vector of finite whole numbers (R `NULL`, an empty vector, Python `()`, and an omitted or `undefined` JS `fixed` mean no fixed products and pass; JS: TypeError for a non-array or a non-number element) | `` `fixed` must be a vector of whole-number product indices. `` |
| Any index outside the host range (R 1 to cols, Python/JS 0 to cols − 1; covers 0 and negatives in R; never validate with `[`) | `` `fixed` must hold product indices from <lo> to <hi>. `` (RangeError in JS) |
| Fixed product reaches no respondent | `` Fixed product <name> reaches no respondent. `` |
| More fixed products than `size` | `` `size` is <size>, but <f> products are fixed. `` |

Each check reports the first bad entry in the order given, so all ports name
the same product. `turf_min_cover` has no `size`, so it uses only the first
three checks, in this order: the two `fixed` checks, then `No product reaches
any respondent.`, then the zero-reach check. `turf_sizes` validates `fixed`
before its sizes loop, so `sizes = []` still rejects a bad `fixed`. JS uses
RangeError for every value check, TypeError only for wrong types. Zero-reach
fixed products are an error: they are outside the candidate set,
and their penetration term is 1/0.

### turf_min_cover and turf_sizes

- `turf_min_cover(reach, fixed)`: the smallest portfolio that contains `F` and
  reaches every reachable respondent. Same row `Σ_{j∈F} x_j = |F|`.
- `turf_sizes(reach, sizes, tiebreak, fixed)`: default sizes are
  `max(1, |F|) … turf_min_cover(reach, fixed).size`. An explicit size below
  `|F|` is the error above.

### Result

- Add `fixed` to the portfolio: the fixed product indices, sorted (empty when
  none). R `turf_portfolio$fixed`, Python `Portfolio.fixed` (last field,
  default `()`), JS `Portfolio.fixed`. R print adds a `Fixed:` line when
  non-empty, with the product names. `turf_sizes()` data frame: no new column.

### Conformance

- `generate.py`: enumerate `F ∪ S` for every `(size − |F|)`-subset `S` of the
  free candidates. New fixture `fixed.json`:
  `{"id","input","size","tiebreak","fixed","expected"}`, `fixed` 1-based as
  in the spec; plus `fixed` cases for `min_cover` and `sizes` (new files or a
  `fixed` key, generator owner's choice). Same exclusion rule for near-ties.
- Required cases: fixed product that is the later twin of a free product
  (identical-300; tie-matrix columns all differ), empty `fixed`, duplicate
  and unordered indices, a fixed column after an excluded zero column, all
  candidates fixed, fixed twin pairs, `size == |F|`, F that
  already covers everyone, F with tie-breaks on and off.
- Pass rule 1 gains: the result contains every fixed product and reports
  `fixed`. The min_cover rule gains the same check (today it checks only size
  and reach, so a free twin would pass); its expected size is computed over
  `F ∪ S`. The R sizes rule checks the `turf()` portfolio per row, as
  `run_r.R` already does, since the data frame has no indices.
- Runners (`run_r.R`, `test_conformance.py`, `conformance.mjs`) pass `fixed`
  through, converting to the host base.
- Error messages: one unit test per port for each new message.

### Dashboard

- Settings: a "Fixed products" control under portfolio sizes. A list of
  check boxes with the product names and their reach, scrollable at a fixed
  height (cafe has 40 products), with a text filter when there are more than
  about 12 products. Products with zero reach at the current threshold are
  disabled. "Clear" link when any are checked.
- Size range: the smallest size is `max(1, |F|)`; the cover request carries
  `fixed`, so the hint reads "N products, the fixed ones included, reach every
  respondent that any product reaches."
- `worker.ts`: `run`, `cover`, `analyze` requests carry `fixed`.
- `analysis.ts` `SizeModel`: add the fixed row and the free-only symmetry
  rows to `base`, the fixed row to `plain`. `frontier` `maxFrequency` =
  fixed reaches + the top `size − |F|` free reaches (else it reports `limit`).
  Stage counts then count portfolios that contain `F`.
- `contrib.ts`: `contributions()` puts the fixed products first (greedy
  order among them, earlier column on ties), then the free ones. Pass F into
  `stackColumns`: fixed products take the first color slots, so every column
  stacks them at the bottom and the free products show what they add on top.
  Free products keep the existing stable slot order.
- Results: fixed products marked in the headline list, the product reach
  chart, and the table ("fixed" after the name, plain text, no badge). CSV
  export adds a `fixed` column (names joined, same for every row).
- Loading another data set always clears `fixed` (indices belong to that
  table). A threshold change unfixes only products whose reach becomes zero,
  and says so. `settingsKey` includes `fixed`.
- Each run stores its own `fixed`. Analysis requests, labels, chart marks,
  and the CSV use the run's copy, never the current settings.
- `sizeRange` rejects a start below `|F|`. When the user has not touched the
  sizes, a change of `fixed` sets the start to `max(1, |F|)` at once, and the
  cover reply sets the end to `max(start, min(cover, DEFAULT_MAX_SIZE, cols))`,
  so `|F| > DEFAULT_MAX_SIZE` never gives start > end. Check boxes store
  column indices.
- `productBars` marks `run.fixed` in results and `state.fixed` in the
  preview.
- The fixed-product list and its filter update in place on worker replies, so
  typing in the filter keeps focus (`focusSelector` covers only `#results`
  today).
- `worker.ts` `plain()` copies `fixed`; `data.ts` `resultsCsv` adds the
  column.
- Tests: extend `worker.test.ts` with one fixed run (result contains F, equals
  the enumerated F-optimum on a small matrix), fixed stage counts, and a
  fixed frontier that ends `complete` at the constrained maximum frequency;
  `test-browser/run.mjs` with one check-a-product run.


## Batches

### Batch 1 [B1]: Specification and conformance

**Tasks:** `docs/algorithm.md` sections 1, 2, 3, 6, 9, 11, 12, 15; the
generator, the fixture cases, `conformance/README.md`; runner support for the
new cases in R, Python, and JS (the runners may fail on the new cases until
B2 and B3).

**Acceptance criteria:**
- [ ] B1-A1: docs/algorithm.md specifies the fixed argument, the model row, the free-only symmetry rows, the post-solve check, the error table, turf_min_cover and turf_sizes with fixed, and the fixed result field.
- [ ] B1-A2: conformance/generate.py --check passes and test_generate.py passes, with fixed cases for turf, min_cover, and sizes that cover every required case in the design.
- [ ] B1-A3: The expected values of the fixed cases come from exact enumeration over portfolios that contain every fixed product.

**Risk:** standard. **Review focus:** the spec is the contract for B2 to B4.
**Depends on:** none.

### Batch 2 [B2]: R reference implementation

**Acceptance criteria:**
- [ ] B2-A1: R turf(), turf_min_cover(), and turf_sizes() accept fixed and pass every conformance fixture with Rscript conformance/run_r.R, and run_r.R loads the fixed cases and passes fixed into each call.
- [ ] B2-A2: testthat covers each new error message and the case of a fixed product that is the later twin of a free product, and R CMD check gives no new NOTE, WARNING, or ERROR.
- [ ] B2-A3: Calls without fixed give the same results as before (existing tests and fixtures pass unchanged).
- [ ] B2-A4: print() of a portfolio with fixed products shows a Fixed: line with the product names, and no such line without them.

**Risk:** standard. **Review focus:** symmetry rows, check order, R index
handling. **Depends on:** B1.

### Batch 3 [B3]: Python and JavaScript ports

**Acceptance criteria:**
- [ ] B3-A1: Python turf, turf_min_cover, and turf_sizes accept keyword-only fixed and pytest passes, conformance included, with presolve on and off, and the Python runner loads the fixed cases and passes fixed into each call.
- [ ] B3-A2: JavaScript turf, turfMinCover, and turfSizes accept options.fixed, and npm run typecheck, test, build, and test:conformance pass, with presolve on and off, and the JavaScript runner loads the fixed cases and passes fixed into each call.
- [ ] B3-A3: Each port tests each new error message with the exact text and error type.

**Risk:** standard. **Depends on:** B1, B2.

### Batch 4 [B4]: Dashboard

**Acceptance criteria:**
- [ ] B4-A1: The dashboard settings let the user fix products, and a run returns portfolios that contain them for every size, with the smallest size at the number of fixed products.
- [ ] B4-A2: The stage counts, the trade-off, the contributions chart, the table, and the CSV use the fixed products of the run.
- [ ] B4-A3: npm run typecheck, test, build, and test:browser pass in dashboard/, with a test for a fixed run, fixed stage counts, and a fixed trade-off that ends complete with maxFrequency equal to the fixed reaches plus the largest free reaches.
- [ ] B4-A4: Loading another data set clears the fixed products, and a threshold change unfixes only the products whose reach becomes zero and says so on the page.

**Risk:** standard. **Review focus:** state handling when data, threshold, or
fixed change. **Depends on:** B3.

### Batch 5 [B5]: Docs and version

**Acceptance criteria:**
- [ ] B5-A1: README.md, python/README.md, js/README.md, dashboard/README.md, roxygen and man/, and NEWS.md describe fixed products.
- [ ] B5-A2: R, Python, JavaScript, and dashboard versions are 0.3.0 in every file that carries the version, lock files (python/uv.lock, js and dashboard package-lock.json), python/src/turflp/__init__.py, and README examples included.

**Risk:** low. **Depends on:** B4.

## Master acceptance

- [ ] M-A1: All reviewers report no blocking finding on the cumulative diff at the final head.
- [ ] M-A2: Every documented local gate passes on the final head: conformance check and self-test, run_r.R, R CMD check, pytest, js typecheck, test, build, test:conformance, dashboard typecheck, test, build, test:browser.
- [ ] M-A3: Every GitHub Actions check on the exact final PR head is green, the Python wheel and Next.js example checks included.
- [ ] M-A4: The PR is merged with a merge commit, release v0.3.0 is published on that merge commit with turflp-dashboard.html attached, and the publish-npm and publish-python workflows of the release succeed.
