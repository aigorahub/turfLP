# turfLP conformance suite

One set of fixtures binds the R, Python, and JavaScript implementations of turfLP. The expected values come from exact enumeration of every portfolio, never from a solver. `docs/algorithm.md` is the specification the implementations follow; this folder tests their observable results.

## Files

| Path | Contents |
|---|---|
| `export_r.R` | Freezes the matrices that only R can make (R random seeds, package data) into `inputs/` and the package data sets into `data/` as CSV. Run it only when a recipe in it changes. |
| `inputs/*.json` | Reach matrices. `gen-*` files are written by `generate.py`; the others by `export_r.R`. |
| `data/*.csv` | The seven package data sets (raw ratings, header row of product names). The Python and JavaScript packages copy these files. |
| `manifest.json` | SHA-256 digest, size, origin, and source of every input; case counts; excluded cases with reasons. |
| `generate.py` | Standard-library Python. Checks the inputs against the manifest, enumerates, and writes `fixtures/`. |
| `test_generate.py` | Hand-checked tests of the generator. |
| `fixtures/*.json` | The fixtures (below). |
| `run_r.R` | Runs every fixture against the R package. |
| `../python/tests/test_conformance.py` | Runs every fixture against the Python package (`pytest`), with presolve on and off. |
| `../js/scripts/conformance.mjs` | Runs every fixture against the built JavaScript package (`npm run test:conformance`), with presolve on and off. |

Commands, from the repository root:

```sh
python3 conformance/generate.py --check     # inputs match the manifest; fixtures are current
python3 conformance/test_generate.py        # generator self-test
Rscript conformance/run_r.R                 # R package against the fixtures
```

After changing a recipe: `Rscript conformance/export_r.R` (R-made inputs only), then `python3 conformance/generate.py --write`, and commit the changed inputs, manifest, and fixtures together.

## Input format

```json
{
  "name": "tie-matrix",
  "source": "tests/testthat/test-turf.R tie_matrix",
  "rows": 8,
  "cols": 5,
  "names": ["P1", "P2", "P3", "P4", "P5"],
  "columns": ["06", "93", "69", "64", "d9"]
}
```

Each column is a hexadecimal string of `ceil(rows / 4)` digits. Row 1 is the most significant bit of the first digit; the unused bits of the last digit are 0. The column `06` above is `0000 0110`: rows 6 and 7 are 1.

## Fixture format

Every fixture file has `schema_version` (1), `kind`, and `cases`. Product indices in fixtures never matter: a result passes on its values, because tied portfolios are common and different HiGHS versions can return different optima.

**`turf.json`**: `{"id", "input", "size", "tiebreak", "expected"}`. `expected` always has `reach`, has `frequency` when `"frequency"` is in `tiebreak`, and has `penetration` (`{"fraction": "p/q", "value": double}`, the harmonic mean) when `"penetration"` is in `tiebreak`.

**`min_cover.json`**: `{"id", "input", "expected": {"size", "reachable"}}`.

**`sizes.json`**: `{"id", "input", "sizes", "tiebreak", "expected"}`. `sizes` is a list or `null` (the default: 1 to the minimum cover size). `expected` is one object per result row, in order, with `size` and the `turf` fields.

**`bounded.json`**: `{"id", "input", "size", "tiebreak", "max_pool", "max_pool_seconds", "warnings", "expected"}`. `max_pool_seconds` is a number or `null` (no limit). These cases force the pool or time limits, so the result is not a full optimum.

**`format.json`**: `{"value", "text"}`, the `%g` formatting of a time budget in warning texts (`docs/algorithm.md` section 10).

**`comparator.json`**: `{"size", "old", "new", "worse"}`, the comparison rule of `docs/algorithm.md` section 5 for one minimized criterion: `worse` is true when `new > old + 16 * size * epsilon * max(1, |old|)`. The values sit below, at, and one representable double above the threshold.

## Pass rule

Exact fixtures (`turf`, `min_cover`, `sizes`) run with no pool time limit (`max_pool_seconds` infinite), so that machine speed cannot change the result. Only bounded fixtures set limits.

**turf.** The result passes when:

1. It selects exactly the requested `size` of distinct products, each a valid column index that reaches at least one respondent, and reports that size.
2. Every reported field equals its recomputation from the returned indices and the input: `names`, `size`, `reach` (respondents reached by at least one selected product), `respondents` (all rows), `reach_prop`, `frequency` (sum of the selected column sums), and `penetration` (`size / sum(1 / r_j)`).
3. `reach` equals `expected.reach`, and each criterion present in `expected` equals it: `frequency` exactly, and `penetration` either exactly as a fraction recomputed from the selected column sums (Python, JavaScript) or as a double within `16 * size * epsilon * max(1, |value|)` of `expected.penetration.value` (R). Criteria that the call did not request are recomputed (rule 2) but not compared with an optimum.

**min_cover.** The result selects distinct products that together reach every reachable respondent (`reach == expected.reachable`), its size equals `expected.size`, and rule 2 holds.

**sizes.** The result has one row per requested size, in order, and each row passes the `turf` rule against its expected row.

**bounded.** The call is made with the given limits. The warnings are exactly `warnings`, in order. Rule 2 holds, and the values in `expected` (the criteria that the limits cannot affect) are equal as in the `turf` rule.

**format.** The implementation's warning number format of `value` equals `text`.

**Checkers.** Each runner first checks that its own checker rejects a self-consistent result of the wrong size, a duplicate index, and an index out of range.

**comparator.** The implementation's comparison of `new` with `old` for a minimized criterion returns `worse`.

## Exclusions

`generate.py` leaves out a `turf` case when, after the earlier criteria are fixed, the best exact penetration and the nearest distinct eligible penetration differ by more than 0 but not more than twice the comparison tolerance. Such values cannot be ranked reliably in double precision, so an implementation may return either. The comparator fixtures test the tolerance rule itself. `manifest.json` lists every excluded case with its reason, including cases left out by design (the 2,600 by 202 run-time matrices, whose results depend on machine speed).
