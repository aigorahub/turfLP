# turfLP algorithm specification

This document is the normative specification for every turfLP implementation: the R package at the repository root, the Python package in `python/`, and the JavaScript package in `js/`. Where this document is silent, `R/turf.R` is the reference. Each rule names the R function it mirrors. The shared conformance suite in `conformance/` tests the observable results.

Indices in this document are 1-based, as in R. Python and JavaScript use 0-based product indices in their public results.

## 1. Input

Mirrors `as_reach_matrix()` and `check_size()` / `check_tiebreak()`.

The reach matrix has one row per respondent and one column per product. Implementations accept the host language's natural tabular forms (R: matrix or data frame; Python: nested lists, NumPy arrays, objects with `to_numpy()` and `columns`; JavaScript: arrays of arrays). Numeric values must be exactly 0 or 1, and logical values must be false or true.

Errors, in this order, with these exact messages:

| Condition | Message |
|---|---|
| Not a numeric or logical table | `` `reach` must be a numeric or logical matrix or data frame. `` |
| Zero rows or zero columns | `` `reach` must have at least one row and one column. `` |
| Any missing value (R `NA`, Python `None` or NaN, JavaScript `null`, `undefined`, or `NaN`) | `` `reach` must not contain missing values. `` |
| Any value other than 0, 1, false, true | `` `reach` must contain only 0 and 1, or FALSE and TRUE. `` |
| `size` not a single finite whole number of 1 or more | `` `size` must be a single whole number of 1 or more. `` |
| `size` larger than the number of products that reach at least one respondent (`m`) | `` `size` is <size>, but only <m> products reach at least one respondent. `` |
| No product reaches any respondent (`turf_min_cover`) | `No product reaches any respondent.` |

Product names come from the column names. When there are none, the names are `P1`, `P2`, and so on (1-based in every language).

`tiebreak` is an ordered list of distinct criteria drawn from `"frequency"` and `"penetration"`. The default is `["frequency", "penetration"]`. An empty list means reach only. Duplicates are removed, keeping the first occurrence. Any other value is an error (R uses `match.arg`; ports use the message `` `tiebreak` must contain only "frequency" and "penetration". ``).

## 2. Reduction

Mirrors the start of `turf()`.

- `r_j` is the number of respondents that product `j` reaches (column sum).
- Candidate products are those with `r_j > 0`, in column order. Other products are never selected.
- The model uses only respondents that at least one candidate reaches. Other respondents stay in `respondents` and in the denominator of `reach_prop`.
- `n` is the number of model respondents and `m` the number of candidates. `a` is the reduced `n` by `m` matrix.

## 3. Model

Mirrors the `model` list in `turf()`.

Variables, in this order:

- `z_1 … z_n`: continuous, `0 ≤ z_i`, no upper bound. `z_i` counts respondent `i` as not reached.
- `x_1 … x_m`: binary. `x_j = 1` selects candidate `j`.
- `p`: continuous, `0 ≤ p`. `p` is a copy of the penetration sum.

Rows:

- For each respondent `i`: `z_i + Σ_j a_ij x_j ≥ 1`.
- Size: `Σ_j x_j = size`.
- Penetration copy: `p − Σ_j c_j x_j = 0`, with `c_j = max_k(r_k) / r_j` over candidates.
- Symmetry: when candidate `j` has the same set of reached respondents as an earlier candidate, let `j'` be the latest such earlier candidate and add `x_j' − x_j ≥ 0`. This selects identical products in column order.

For integer `x`, the smallest feasible `z_i` is 1 when no selected product reaches respondent `i` and 0 otherwise.

## 4. Criteria

Mirrors the `objectives` list in `turf()`. Each criterion has a direction, an objective vector, and a value computed from the selected products (`sel`), never from the solver's continuous variables.

| Criterion | Direction | Objective | Value from `sel` |
|---|---|---|---|
| reach | minimize | `Σ_i z_i` | `n −` (number of model respondents reached by `sel`) |
| frequency | maximize | `Σ_j r_j x_j` | `Σ_{j∈sel} r_j` |
| penetration | minimize | `p` | `Σ_{j∈sel} c_j` |

Stages run in the order `reach`, then the `tiebreak` criteria.

## 5. Comparison rule

Mirrors `tolerance()`, `worse_on_earlier()`, and `best_of()`.

Signed value: `v = value` for a minimized criterion, `v = −value` for a maximized one, so smaller is better.

Two signed values `new` and `old` are equal when `|new − old| ≤ tol(old)`, with `tol(x) = 16 × size × ε × max(1, |x|)` and `ε` the double-precision machine epsilon (`2^−52`). Reach and frequency are whole numbers, so the rule compares them exactly.

- `worse_on_earlier(criteria, sel, prev)`: for each criterion in order, if `new > old + tol(old)` return true; if `new < old − tol(old)` return false; otherwise continue. Return false at the end.
- `best_of(pool, criteria)`: keep all pool entries; for each criterion in order, keep the entries whose signed value is at most `min + tol(min)`. Return the first remaining entry in pool order.

## 6. One stage with checks

Mirrors `next_valid()` and `exclude()`.

`next_valid(model, criterion, earlier, previous, deadline)` repeats at most 100 times (`max_solves`):

1. If a deadline is set and has passed, return status `time`.
2. Solve the model for the criterion, with the remaining time as the solver time limit.
3. Read the model status, not the return code of the call. If the status is infeasible, return status `none`. If it is the time limit, return status `time`.
4. If the solution is not optimal, or any `x_j` is missing, or the number of `x_j > 0.5` is not `size`, or any `x_j` is more than `1e-6` from 0 or 1: when `previous` is absent (the first stage), raise the error `HiGHS returned an invalid solution in the <criterion> stage.`; otherwise return status `invalid`.
5. `sel` = the candidates with `x_j > 0.5`. If `previous` is absent, or `worse_on_earlier(earlier, sel, previous)` is false, return status `ok` with `sel`.
6. Otherwise add the no-good row `Σ_{j∈sel} x_j ≤ size − 1` (which excludes exactly `sel`) and repeat.

After 100 solves, return status `limit`. In the first stage (reach) there is no `previous`, so any solver failure other than a valid optimum is an error.

## 7. Stage loop

Mirrors the `for (s in seq_along(stages))` loop in `turf()`.

For each stage `s` with criterion `C` and earlier criteria `E`:

1. `res = next_valid(model, C, E, previous)` with no deadline. If the status is not `ok`, emit warning W1 for `C` and stop the loop (the result is the last `sel`).
2. If `C` is penetration, run section 8 and stop the loop.
3. Set `previous = sel`. If `C` is not the last stage, add the exact bound row for `C`: `objective(C) ≤ value(C, sel)` for a minimized criterion, `≥` for a maximized one.

The result is built from the final `sel` (section 9).

## 8. Penetration stage

Mirrors the `if (stages[s] == "penetration")` block in `turf()`.

1. Keep a copy of the model without the pool rows (`without_pool`).
2. `bound = value(penetration, sel)`. `pool = [sel]`, `last = sel`. Add the row `p ≤ bound`.
3. Set a deadline 30 seconds from now (`max_pool_seconds`). Repeat at most 1000 times (`max_pool`):
   - Add the no-good row for `last`.
   - `res = next_valid(model, penetration, E, previous, deadline)`.
   - If the status is `none`, the pool is complete; stop.
   - If the status is `time`, `limit`, or `invalid`, the pool is incomplete with that reason; stop.
   - `last = res.sel`. If `value(penetration, last) ≤ bound + tol(bound)`, append `last` to the pool.
   - If the loop reaches 1000 iterations without stopping, the pool is incomplete with reason `full`.
4. If the pool is complete: `sel = best_of(pool, [penetration] + later criteria)`.
5. If the pool is incomplete: emit warning W2 with the reason, set `sel = best_of(pool, [penetration])`, and if a later criterion exists, solve it with `next_valid(without_pool + row p ≤ value(penetration, sel), later, E + [penetration], sel, now + 30 seconds)`. If that returns `ok`, use its `sel`; otherwise emit warning W1 for the later criterion with the penetration wording.

## 9. Result

Mirrors `new_portfolio()`.

| Field | Value |
|---|---|
| `products` | selected original column indices, sorted ascending (R 1-based; Python and JavaScript 0-based) |
| `names` | the names of those columns, in the same order |
| `size` | number of selected products |
| `reach` | number of respondents (of all rows) that at least one selected product reaches |
| `reach_prop` | `reach / respondents` |
| `frequency` | `Σ r_j` over selected products |
| `penetration` | `size / Σ (1 / r_j)` over selected products (harmonic mean) |
| `respondents` | number of rows of the input |

## 10. Warnings

Texts are identical in every implementation. `<limit>` is 100, `<pool>` is 1000, and `<seconds>` is 30, formatted as R's `%g` (`30`, `0`, `0.5`).

W1, stage did not finish:

> The `<stage>` stage did not finish (`<reason>`). The portfolio is optimal on the earlier criteria but may not be optimal on `<stage>`.

After an incomplete penetration pool, the middle phrase is "penetration only to within the solver tolerance and" instead of "the earlier criteria but". `<reason>` is `<limit> solves`, `time limit of <seconds> seconds`, `HiGHS returned an invalid solution`, or `HiGHS found no valid portfolio`.

W2, penetration search stopped:

> The search for the penetration optimum stopped (`<reason>`). The penetration is optimal only to within the solver tolerance (about 1e-9).

`<reason>` is `more than <pool> portfolios are within the solver tolerance`, `time limit of <seconds> seconds`, `<limit> solves`, or `HiGHS returned an invalid solution`.

## 11. Minimum cover

Mirrors `turf_min_cover()`.

Minimize `Σ_j x_j` subject to `Σ_j a_ij x_j ≥ 1` for every model respondent, with `x` binary over the candidates. The result is built as in section 9. Implementations must check that the selection covers every model respondent and raise `HiGHS returned an invalid solution in the set cover stage.` when it does not.

## 12. Portfolio sizes

Mirrors `turf_sizes()`.

`turf_sizes(reach, sizes, tiebreak)` returns one result per size, in the given order. When `sizes` is absent, it is `1 … turf_min_cover(reach).size`.

## 13. Solver settings

| Setting | R (`highs` 1.14) | Python (`highspy` ≥ 1.15.1) | JavaScript (`highs` ≥ 1.15.3) |
|---|---|---|---|
| presolve | off (HiGHS 1.14 presolve bug) | on | on |
| `mip_rel_gap`, `mip_abs_gap` | 0 | 0 | 0 |
| `primal_feasibility_tolerance`, `mip_feasibility_tolerance` | 1e-9 | 1e-9 | 1e-9 |
| threads | 1 | 1 | not set: the WebAssembly build is single-threaded, and `createModel()` rejects thread options |
| `time_limit` | remaining stage time, or none | same | same |

The package versions are not the HiGHS versions: npm `highs@1.15.3` embeds HiGHS 1.15.1. The ports report both in their test output.

Presolve is the one named difference. Each port's test suite runs the conformance suite with presolve on (the default) and again with presolve off, through an internal test setting that is not part of the public API.

## 14. Limits, budgets, and clocks

| Limit | Value | Scope |
|---|---|---|
| `max_solves` | 100 | solves in one `next_valid` call (section 6) |
| `max_pool` | 1000 | iterations of the penetration pool loop (section 8) |
| `max_pool_seconds` | 30 | one budget shared by all pool solves, and a separate new budget for the later frequency fallback (section 8) |

The reach stage, a frequency stage before penetration, and the first penetration solve have no time limit. Deadlines use a monotonic clock: R `proc.time()[["elapsed"]]`, Python `time.monotonic()`, JavaScript `performance.now() / 1000`. The budgets bound solver time inside the stages that have them, not the total wall time of a call.

R exposes `max_pool` and `max_pool_seconds` as the options `turfLP.max_pool` and `turfLP.max_pool_seconds`. The ports take them as arguments (section 15). `max_solves` is fixed.

## 15. Public API

### R (reference)

```r
turf(reach, size, tiebreak = c("frequency", "penetration"))
turf_min_cover(reach)
turf_sizes(reach, sizes = NULL, tiebreak = c("frequency", "penetration"))
```

`turf()` and `turf_min_cover()` return a `turf_portfolio` list with the fields in section 9; `turf_sizes()` returns a data frame with one row per size and the columns `size`, `reach`, `reach_prop`, `frequency`, `penetration`, and `products` (names joined with ", "). Warnings are R warnings.

### Python

```python
from turflp import turf, turf_min_cover, turf_sizes, Portfolio, TurfWarning

def turf(reach, size: int, tiebreak=("frequency", "penetration"), *,
         names=None, max_pool: int = 1000, max_pool_seconds: float = 30.0) -> Portfolio: ...
def turf_min_cover(reach, *, names=None) -> Portfolio: ...
def turf_sizes(reach, sizes=None, tiebreak=("frequency", "penetration"), *,
               names=None, max_pool: int = 1000, max_pool_seconds: float = 30.0) -> list[Portfolio]: ...

@dataclass(frozen=True)
class Portfolio:
    products: tuple[int, ...]     # 0-based column indices, ascending
    names: tuple[str, ...]
    size: int
    reach: int
    reach_prop: float
    frequency: int
    penetration: float
    respondents: int

class TurfWarning(UserWarning): ...
```

- `reach` is a nested list, a NumPy array, or any object with `to_numpy()` and `columns` (for example a pandas data frame). Names come from `names`, else from `columns`, else `P1`, `P2`, ….
- `tiebreak` is a sequence of strings; an empty sequence means reach only.
- Warnings are emitted with `warnings.warn(text, TurfWarning)`. `turf_sizes` emits each size's warnings as they occur.
- Data sets: `turflp.datasets.load(name) -> Dataset`, a named tuple with `columns: tuple[str, ...]` and `values: numpy.ndarray` (integers), plus `names()` listing the seven data sets. The ratings are raw; the thresholds from the R help pages are documented, not applied.

### TypeScript

```ts
import { loadSolver, turf, turfMinCover, turfSizes, type Portfolio } from "turflp";
import { load as loadDataset, datasetNames } from "turflp/datasets";

type ReachMatrix = ReadonlyArray<ReadonlyArray<number | boolean>>;
type Criterion = "frequency" | "penetration";

interface TurfOptions {
  tiebreak?: readonly Criterion[];      // default ["frequency", "penetration"]
  names?: readonly string[];
  maxPool?: number;                     // default 1000
  maxPoolSeconds?: number;              // default 30
}

interface Portfolio {
  readonly products: readonly number[]; // 0-based column indices, ascending
  readonly names: readonly string[];
  readonly size: number;
  readonly reach: number;
  readonly reachProp: number;
  readonly frequency: number;
  readonly penetration: number;
  readonly respondents: number;
  readonly warnings: readonly string[];
}

function loadSolver(options?: { locateFile?: (file: string) => string; wasmBinary?: ArrayBuffer }): Promise<void>;
function turf(reach: ReachMatrix, size: number, options?: TurfOptions): Promise<Portfolio>;
function turfMinCover(reach: ReachMatrix, options?: { names?: readonly string[] }): Promise<Portfolio>;
function turfSizes(reach: ReachMatrix, sizes?: readonly number[] | null, options?: TurfOptions): Promise<Portfolio[]>;
```

- The first call loads the WebAssembly solver; later calls reuse it. Concurrent first calls share one load. A failed load is not cached. `loadSolver` is optional; calling it again with different options after a successful load throws `turflp: the solver is already loaded with other options.`
- The solve itself is synchronous inside the returned promise and blocks the JavaScript thread until it finishes.
- Errors are thrown as `TypeError` (wrong types) or `RangeError` (bad values) with the texts in section 1.
- Data sets: `load(name)` returns `{ columns: string[]; values: number[][] }`; `datasetNames` lists the seven data sets.
