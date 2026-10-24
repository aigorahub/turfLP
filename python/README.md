# turflp for Python

TURF analysis (total unduplicated reach and frequency) with integer linear programming. This is the Python port of the [turfLP R package](https://github.com/aigorahub/turfLP). It follows the same algorithm specification, limits, and warning texts, with the solver differences listed below. It passes the same conformance suite (`conformance/` in the repository), whose expected optima come from exact enumeration of every portfolio.

The solver is [HiGHS](https://highs.dev) through `highspy`. The dependencies are `highspy` and NumPy.

## Installation

```sh
python -m pip install "turfLP==0.5.0"
```

Python 3.10 or later. The package is `turfLP` on PyPI, and the module is `turflp` (`import turflp`). This guide describes 0.5.0. Pin the version in your application's dependencies and lock its transitive dependencies for repeatable installs. Check the loaded version with `python -c "import turflp; print(turflp.__version__)"`. To install the development version from the repository:

```sh
python -m pip install "git+https://github.com/aigorahub/turfLP.git#subdirectory=python"
```

## Usage

The input is a matrix with one row per respondent and one column per product: nested lists, a NumPy array, or a pandas data frame. A 1 (or `True`) means that the product reaches the respondent. Other cells must be 0 (or `False`); empty matrices and missing values are rejected. Convert ratings to booleans before calling the solver. Rows with no reached products still count in the denominator. Install pandas separately if you use its data frames. The [usage guide](https://github.com/aigorahub/turfLP/blob/main/docs/usage.md) explains each result field and the choice of sizes.

```python
from turflp import turf, turf_sizes, datasets

ham = datasets.load("ham")          # 127 consumers, 9-point liking of 8 hams
reach = ham.values >= 7             # top-3 box
print(turf(reach, 2, names=ham.columns))
# Portfolio(products=(3, 4), names=('N4', 'S1'), size=2, reach=98, reach_prop=0.7716535433070866,
#           frequency=118, penetration=58.98305084745762, respondents=127, fixed=())

# Product N1 (column 0) must be in the portfolio; the stages choose the other two.
p = turf(reach, 3, names=ham.columns, fixed=[0])
print(p.names, p.reach)
# ('N1', 'N4', 'S1') 110

for p in turf_sizes(reach, [1, 2, 3, 4], names=ham.columns):
    print(p.size, p.reach, p.names)
# 1 60 ('S1',)
# 2 98 ('N4', 'S1')
# 3 111 ('N2', 'N3', 'S1')
# 4 119 ('N1', 'N3', 'N4', 'S1')
```

## Functions

```python
turf(reach, size, tiebreak=("frequency", "penetration"), *,
     names=None, fixed=(), max_pool=1000, max_pool_seconds=30.0) -> Portfolio
turf_min_cover(reach, *, names=None, fixed=()) -> Portfolio
turf_sizes(reach, sizes=None, tiebreak=("frequency", "penetration"), *,
           names=None, fixed=(), max_pool=1000, max_pool_seconds=30.0) -> list[Portfolio]
```

- `turf` finds the `size` products that reach the most respondents. Ties on reach are broken by `tiebreak`, in order: `"frequency"` (the sum of the individual reaches) and `"penetration"` (the harmonic mean of the individual reaches). An empty `tiebreak` means reach only.
- `size` must be a positive whole number, at least the number of distinct fixed products and at most the number of products that reach someone. Every explicitly requested size has the same bounds.
- `fixed` lists the 0-based column indices of products that every portfolio must contain, for example products already on the shelf. `size` counts them, and the stages choose the other products. Each fixed product must reach at least one respondent; duplicates are ignored, and a set is rejected because it has no order.
- `turf_min_cover` finds the fewest products that together reach every respondent that some product reaches, with the `fixed` products among them.
- `turf_sizes` solves several sizes. The default is every size from 1 (or the number of fixed products) to the minimum cover size with the same `fixed`.
- `Portfolio` is a frozen dataclass with `products`, `names`, `size`, `reach`, `reach_prop`, `frequency`, `penetration`, `respondents`, and `fixed` (the fixed column indices, ascending).
- `names` gives the product names; otherwise they come from the data frame columns, or are `P1`, `P2`, and so on.

## Limits and warnings

The penetration tie-break is decided in Python, not by the solver: the package collects every portfolio whose penetration can equal the optimum and compares them with the rule in `docs/algorithm.md` section 5. After the first penetration solve, that search examines up to `max_pool` more portfolios (1000 by default) within `max_pool_seconds` seconds (30 by default). If it stops early and frequency comes next, the frequency stage gets another `max_pool_seconds`. When a search stops early, the package emits a `turflp.TurfWarning` that says which result is not proved optimal. `max_pool` must be a whole number of 0 or more and `max_pool_seconds` a number of 0 or more (`math.inf` for no limit); they are checked before any solve. The reach stage and the first penetration solve have no time limit.

To keep warnings with a result, use Python's warning API:

```python
import warnings
from turflp import TurfWarning, turf

with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter("always", TurfWarning)
    p = turf([[1, 0], [0, 1]], 1)
messages = [str(w.message) for w in caught if issubclass(w.category, TurfWarning)]
```

The budget does not bound the whole call. Run the solve in a separate process if your application needs a hard deadline. Each search for a valid solution also stops after 100 solver attempts. An invalid solver solution after a valid portfolio exists emits a warning and retains a valid portfolio. Without a valid result, the call raises an exception. Invalid inputs also raise exceptions; do not treat them as a portfolio with zero reach.

## Differences from R

- Product indices are 0-based (`products=(3, 4)` above is `c(4, 5)` in R).
- `turf_sizes` returns a list of `Portfolio` values instead of a data frame.
- Warnings are `TurfWarning` warnings with the same texts as the R warnings.
- The limits are keyword arguments instead of the R options `turfLP.max_pool` and `turfLP.max_pool_seconds`.
- HiGHS presolve is on. The R package turns it off because HiGHS 1.14, which the R `highs` package bundles, returned a wrong optimum with presolve on in a test case. HiGHS 1.15 solves that case correctly.
- There is no `turf_simulate()`.

When several portfolios are optimal, R, Python, and JavaScript can return different ones, with the same values of the requested criteria. When a search stops early, the warning says which value is not proved optimal.

## Data sets

`turflp.datasets.load(name)` returns a `Dataset(columns, values)` with the raw responses of one of the seven example data sets of the R package: `cafe`, `chips`, `coffee`, `ham`, `icecream`, `lunchbags`, and `pies`. `ham`, `pies`, and `lunchbags` are under CC BY 4.0 and `coffee` under CC0 1.0; see `COPYRIGHTS`.

`turflp.datasets.names()` lists the available names. For the example reach definitions, use `ham.values >= 7`, `coffee.values >= 8`, `icecream.values >= 8`, and `chips.values >= 4`. The `pies`, `lunchbags`, and `cafe` values are already binary. These are example thresholds; the package does not apply them automatically.

## License

MIT. See `LICENSE`. The data licenses are in `COPYRIGHTS`.
