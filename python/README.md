# turflp for Python

TURF analysis (total unduplicated reach and frequency) with integer linear programming. This is the Python port of the [turfLP R package](https://github.com/aigorahub/turfLP). It uses the same algorithm, solver settings, limits, and warning texts, and it passes the same conformance suite (`conformance/` in the repository), whose expected values come from exact enumeration of every portfolio.

The solver is [HiGHS](https://highs.dev) through `highspy`. The dependencies are `highspy` and NumPy.

## Installation

The package is not on PyPI yet. Install it from the repository:

```sh
pip install "git+https://github.com/aigorahub/turfLP.git#subdirectory=python"
```

Python 3.10 or later.

## Usage

The input is a matrix with one row per respondent and one column per product: nested lists, a NumPy array, or a pandas data frame. A 1 (or `True`) means that the product reaches the respondent.

```python
from turflp import turf, turf_sizes, datasets

ham = datasets.load("ham")          # 127 consumers, 9-point liking of 8 hams
reach = ham.values >= 7             # top-3 box
print(turf(reach, 2, names=ham.columns))
# Portfolio(products=(3, 4), names=('N4', 'S1'), size=2, reach=98, reach_prop=0.7716535433070866,
#           frequency=118, penetration=58.98305084745762, respondents=127)

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
     names=None, max_pool=1000, max_pool_seconds=30.0) -> Portfolio
turf_min_cover(reach, *, names=None) -> Portfolio
turf_sizes(reach, sizes=None, tiebreak=("frequency", "penetration"), *,
           names=None, max_pool=1000, max_pool_seconds=30.0) -> list[Portfolio]
```

- `turf` finds the `size` products that reach the most respondents. Ties on reach are broken by `tiebreak`, in order: `"frequency"` (the sum of the individual reaches) and `"penetration"` (the harmonic mean of the individual reaches). An empty `tiebreak` means reach only.
- `turf_min_cover` finds the fewest products that together reach every respondent that some product reaches.
- `turf_sizes` solves several sizes. The default is every size from 1 to the minimum cover size.
- `Portfolio` is a frozen dataclass with `products`, `names`, `size`, `reach`, `reach_prop`, `frequency`, `penetration`, and `respondents`.
- `names` gives the product names; otherwise they come from the data frame columns, or are `P1`, `P2`, and so on.

## Limits and warnings

The penetration tie-break is decided in Python, not by the solver: the package collects every portfolio whose penetration can equal the optimum and compares them with the rule in `docs/algorithm.md` section 5. After the first penetration solve, that search examines up to `max_pool` more portfolios (1000 by default) within `max_pool_seconds` seconds (30 by default). If it stops early and frequency comes next, the frequency stage gets another `max_pool_seconds`. When a search stops early, the package emits a `turflp.TurfWarning` that says which result is not proved optimal. `max_pool` must be a whole number of 0 or more and `max_pool_seconds` a number of 0 or more (`math.inf` for no limit); they are checked before any solve. The reach stage and the first penetration solve have no time limit.

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

## License

MIT. See `LICENSE`. The data licenses are in `COPYRIGHTS`.
