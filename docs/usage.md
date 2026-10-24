# Using turfLP

turfLP chooses a fixed number of products to reach as many respondents as possible. Use it when you have one response for each respondent and product, and can define whether that response counts as reached.

## Choose an interface

| Need | R | Python | JavaScript |
|---|---|---|---|
| Best portfolio of one size | `turf()` | `turf()` | `turf()` |
| Best portfolio at several sizes | `turf_sizes()` | `turf_sizes()` | `turfSizes()` |
| Fewest products to reach every reachable respondent | `turf_min_cover()` | `turf_min_cover()` | `turfMinCover()` |
| Simulated binary data | `turf_simulate()` | Not provided | Not provided |

Use the [dashboard](../dashboard/README.md) for CSV input and charts. Applications should depend on the released solver package. The dashboard's CSV parser, progress protocol, contribution charts, and deep dive are application code, not exported solver APIs. The packages do not provide authentication, storage, job queues, or a complete web service.

## Prepare a reach matrix

- Each row is one respondent. Each column is one product.
- Cells must be `0` or `1`, or boolean values. Convert ratings to reach with an explicit threshold first.
- Supply at least one row and one column. Remove respondent ID columns before calling the solver.
- Resolve missing responses before analysis. The solver rejects missing values; it does not impute them.
- Rows with no reached products stay in the denominator. A respondent whom no product reaches still counts as a respondent.
- Products that reach nobody cannot be selected. A requested size cannot exceed the number of products with positive reach.

For example, the following data has four respondents. The last respondent is not reached by any product.

| Respondent | A | B | C |
|---|---:|---:|---:|
| 1 | 1 | 0 | 1 |
| 2 | 1 | 0 | 0 |
| 3 | 0 | 1 | 1 |
| 4 | 0 | 0 | 0 |

R:

```r
library(turfLP)
reach <- rbind(c(1, 0, 1), c(1, 0, 0), c(0, 1, 1), c(0, 0, 0))
colnames(reach) <- c("A", "B", "C")
p <- turf(reach, size = 2)
p$names       # "A" "C"
p$reach_prop  # 0.75
```

Python:

```python
from turflp import turf

reach = [[1, 0, 1], [1, 0, 0], [0, 1, 1], [0, 0, 0]]
p = turf(reach, 2, names=["A", "B", "C"])
print(p.names, p.reach_prop)  # ('A', 'C') 0.75
```

JavaScript (ES module):

```js
import { turf } from "turflp";

const reach = [[1, 0, 1], [1, 0, 0], [0, 1, 1], [0, 0, 0]];
const p = await turf(reach, 2, { names: ["A", "B", "C"] });
console.log(p.names, p.reachProp); // ['A', 'C'] 0.75
```

These examples need the [R](../README.md#installation), [Python](../python/README.md#installation), or [JavaScript](../js/README.md#installation) installation first. The solver functions accept matrices, not CSV paths. The dashboard has its own [CSV input rules](../dashboard/README.md#data-format).

## Example dataset thresholds

The packaged datasets contain raw responses. Use these thresholds to reproduce the examples; they are conventions for these examples, not automatic preprocessing by the solver:

| Dataset | Convert to reach |
|---|---|
| `ham` | Rating at least 7 |
| `coffee`, `icecream` | Rating at least 8 |
| `chips` | Rating at least 4 |
| `pies`, `lunchbags`, `cafe` | Already binary; use values directly |

R loads these datasets with the package. Python uses `turflp.datasets.load(name)`; JavaScript uses `load(name)` from `turflp/datasets`. The [dataset sources and licenses](../README.md#example-data) apply when redistributing them.

## Read the result

For the example above, the chosen products A and C reach three respondents. Their individual reaches are both two.

| Field | Meaning | Example |
|---|---|---:|
| `size` | Number of selected products | 2 |
| `reach` | Respondents reached by at least one selected product | 3 |
| `respondents` | All input rows, including rows with no reach | 4 |
| `reach_prop` / `reachProp` | Reach divided by respondents, from 0 to 1 | 0.75 |
| `frequency` | Sum of individual product reaches; overlap counts once per selected product | 4 |
| `penetration` | Harmonic mean of individual product reaches, in respondents | 2 |

Frequency can exceed the number of respondents. Penetration is not a percentage. `products` contains original column indices, and `names` contains their labels. Indices are **1-based in R and 0-based in Python and JavaScript**. `fixed` uses the same index base.

R and Python use `reach_prop`; JavaScript uses `reachProp`. R returns a `turf_portfolio` list, Python a frozen `Portfolio` dataclass, and JavaScript a promise for a `Portfolio` object. R's `turf_sizes()` returns a data frame with product names joined in a `products` column. Python and JavaScript return a list or array of portfolios.

## Choose sizes and tie-breaks

The default order is maximum reach, then maximum frequency among portfolios tied on reach, then maximum penetration among portfolios tied on both. This is an ordered optimization, not a weighted sum. Use an empty `tiebreak` for reach only, or supply either or both later criteria in the required order.

Every size is optimized independently. The best portfolio of size three need not contain the best pair. `turf_sizes()` / `turfSizes()` does not construct a nested sequence.

If sizes are omitted, the solver first finds the minimum cover. It then solves every size from `max(1, number of distinct fixed products)` through that cover size. Pass explicit sizes to control how many solves run. The minimum cover reaches every *reachable* respondent; it may reach less than 100% of all input rows. It minimizes size without applying the frequency and penetration tie-breaks. Larger portfolios cannot increase reach beyond it, but can increase frequency.

## Keep existing products

Pass column indices in `fixed` to require those products in every portfolio. The requested size includes them. With size three and two fixed products, the solver chooses one additional product. Duplicate fixed indices count once. Each fixed product must reach at least one respondent at the chosen threshold.

```r
turf(reach, size = 2, fixed = 1)  # R: require A
```

```python
turf(reach, 2, names=["A", "B", "C"], fixed=[0])
```

```js
await turf(reach, 2, { names: ["A", "B", "C"], fixed: [0] });
```

Fixed products are available from version 0.3.0. Pin a version that includes them.

## Handle warnings and long runs

The default penetration search examines at most 1,000 additional portfolios and has a 30-second budget. If frequency follows penetration, a recovery search can have another 30-second budget. These are **not whole-call timeouts**. The reach stage, a frequency stage before penetration, and the first penetration solve have no time limit. Minimum cover has no application deadline either.

When a search stops early, the warning states which criterion is not proved optimal. Retain the returned portfolio and the warning together. Do not present a warned tie-break as an exact optimum.

| Interface | Warning channel | Budget controls |
|---|---|---|
| R | R warnings | `options(turfLP.max_pool = ..., turfLP.max_pool_seconds = ...)` |
| Python | `turflp.TurfWarning` | `max_pool`, `max_pool_seconds` arguments |
| JavaScript | Result's `warnings` array | `maxPool`, `maxPoolSeconds` options |

Invalid inputs and solver failures raise errors instead of returning a successful portfolio. Catch them at the application boundary. In JavaScript, the promise does not make the solve nonblocking: HiGHS blocks its thread. Use a worker for responsive UI and terminate the worker for a hard cancellation. See the [browser guide](../js/README.md#in-the-browser) and [server example](../js/examples/nextjs/README.md).

## Reproduce an analysis

Keep the input matrix, column order and names, threshold rule, requested sizes, fixed indices, tie-break order, budgets, warnings, package version, and dependency lockfile. Pin the solver version and keep upgrades explicit. See [installation and release checks](development.md#versions-and-releases).

Different solver versions or language ports can select different portfolios when the requested criteria tie. Compare the selected portfolio's validity and criterion values, not only its product names. A time-limited search can also stop at a different point on a different machine. The [conformance suite](../conformance/README.md) explains how results are compared, and the [algorithm specification](algorithm.md) defines the numerical tolerance.
