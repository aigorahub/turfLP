#!/usr/bin/env python3
"""Generate the turfLP conformance fixtures by exact enumeration.

Standard library only. Reads the frozen inputs in conformance/inputs/, checks
them against conformance/manifest.json, enumerates every portfolio, and writes
the fixtures in conformance/fixtures/. No solver is used.

    python3 conformance/generate.py --write   # write inputs, manifest, fixtures
    python3 conformance/generate.py --check   # verify inputs and regenerate in memory

See conformance/README.md for the fixture schema and the pass rule.
"""

import argparse
import hashlib
import json
import math
import sys
from fractions import Fraction
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INPUTS = ROOT / "inputs"
FIXTURES = ROOT / "fixtures"
MANIFEST = ROOT / "manifest.json"

EPS = 2.0 ** -52
SCHEMA_VERSION = 1
# Enumeration stops (and the case is left out, with a recorded reason) above
# this many portfolios for one size.
MAX_COMBINATIONS = 2_000_000
ORDERS = [[], ["frequency"], ["penetration"],
          ["frequency", "penetration"], ["penetration", "frequency"]]
FULL_ORDERS = [["frequency", "penetration"], ["penetration", "frequency"]]


# ---------------------------------------------------------------- inputs ----

def hex_column(bits):
    """Encode a list of 0/1 (row order) as hex, row 1 in the top bit."""
    padded = bits + [0] * ((4 - len(bits) % 4) % 4)
    return "".join(
        "%x" % (8 * padded[i] + 4 * padded[i + 1] + 2 * padded[i + 2] + padded[i + 3])
        for i in range(0, len(padded), 4))


def input_json(name, source, columns_bits, names=None):
    rows = len(columns_bits[0]) if columns_bits else 0
    cols = len(columns_bits)
    if names is None:
        names = ["P%d" % (j + 1) for j in range(cols)]
    lines = [
        "{",
        '  "name": "%s",' % name,
        '  "source": "%s",' % source,
        '  "rows": %d,' % rows,
        '  "cols": %d,' % cols,
        '  "names": [%s],' % ", ".join('"%s"' % n for n in names),
        '  "columns": [',
        ",\n".join('    "%s"' % hex_column(c) for c in columns_bits),
        "  ]",
        "}",
    ]
    return "\n".join(lines) + "\n"


def generated_inputs():
    """Inputs that do not need R. Returns {name: json text}."""
    out = {}
    for n in (100, 101):
        cols = [[1 if i == j else 0 for i in range(n)] for j in range(n)]
        out["gen-diag-%d" % n] = input_json(
            "gen-diag-%d" % n, "identity matrix of order %d" % n, cols)
    # Two correct reach-only answers with different frequency (plan review).
    out["gen-reach-only-3"] = input_json(
        "gen-reach-only-3", "reach-only example with two optima of different frequency",
        [[1, 1], [1, 0], [0, 1]])
    out["gen-reach-only-abc"] = input_json(
        "gen-reach-only-abc", "columns A = 111, B = 100, C = 110",
        [[1, 1, 1], [1, 0, 0], [1, 1, 0]], ["A", "B", "C"])
    return out


class Matrix:
    def __init__(self, text):
        data = json.loads(text)
        self.name = data["name"]
        self.rows = data["rows"]
        self.cols = data["cols"]
        self.names = data["names"]
        if len(self.names) != self.cols or len(data["columns"]) != self.cols:
            raise ValueError("%s: column count mismatch" % self.name)
        self.columns = []
        for h in data["columns"]:
            if len(h) != (self.rows + 3) // 4:
                raise ValueError("%s: column length mismatch" % self.name)
            value = int(h, 16) if h else 0
            bits = bin(value)[2:].zfill(len(h) * 4)
            if "1" in bits[self.rows:]:
                raise ValueError("%s: padding bits set" % self.name)
            # Bit i of the integer is row i.
            self.columns.append(int(bits[:self.rows][::-1] or "0", 2))
        self.reach = [c.bit_count() for c in self.columns]
        self.cand = [j for j in range(self.cols) if self.reach[j] > 0]
        self.max_reach = max((self.reach[j] for j in self.cand), default=0)
        union = 0
        for c in self.columns:
            union |= c
        self.reachable = union.bit_count()


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ----------------------------------------------------------- enumeration ----

def tolerance(value, size):
    return 16 * size * EPS * max(1.0, abs(value))


class Excluded(Exception):
    pass


def near_tie(best, other, max_reach, k):
    """True when two distinct exact reciprocal sums are too close to rank.

    Implementations compare sum(max_r / r_j) in doubles with tolerance(), so
    a gap within twice the tolerance cannot be ranked reliably.
    """
    scaled_best = float(best * max_reach)
    gap = (other - best) * max_reach
    return 0 < gap <= 2 * tolerance(scaled_best, k)


def portfolios(mat, k):
    n = math.comb(len(mat.cand), k)
    if n > MAX_COMBINATIONS:
        raise Excluded("C(%d, %d) = %d portfolios" % (len(mat.cand), k, n))
    return combinations(mat.cand, k)


def union_count(mat, sel):
    u = 0
    for j in sel:
        u |= mat.columns[j]
    return u.bit_count()


def optimum(mat, k, order):
    """Exact lexicographic optimum values for reach then `order`."""
    best_reach = -1
    eligible = []
    for sel in portfolios(mat, k):
        r = union_count(mat, sel)
        if r > best_reach:
            best_reach, eligible = r, [sel]
        elif r == best_reach:
            eligible.append(sel)
    expected = {"reach": best_reach}
    for crit in order:
        if crit == "frequency":
            vals = {sel: sum(mat.reach[j] for j in sel) for sel in eligible}
            best = max(vals.values())
            eligible = [sel for sel in eligible if vals[sel] == best]
            expected["frequency"] = best
        else:
            vals = {sel: sum(Fraction(1, mat.reach[j]) for j in sel) for sel in eligible}
            best = min(vals.values())
            others = sorted(set(v for v in vals.values() if v != best))
            if others and near_tie(best, others[0], mat.max_reach, k):
                raise Excluded("penetration gap %s within twice the tolerance"
                               % float((others[0] - best) * mat.max_reach))
            eligible = [sel for sel in eligible if vals[sel] == best]
            h = Fraction(k) / best
            expected["penetration"] = {"fraction": "%d/%d" % (h.numerator, h.denominator),
                                       "value": float(h)}
    return expected


def min_cover(mat):
    if not mat.cand:
        raise Excluded("no product reaches any respondent")
    for k in range(1, len(mat.cand) + 1):
        for sel in portfolios(mat, k):
            if union_count(mat, sel) == mat.reachable:
                return {"size": k, "reachable": mat.reachable}
    raise AssertionError("unreachable")


# -------------------------------------------------------------- recipes ----

def turf_recipes(names):
    """(input, sizes, orders) for the exact turf fixtures."""
    rec = []
    small = [n for n in names if n.startswith(("random-r-", "gen-reach-only"))]
    for n in sorted(small):
        rec.append((n, "all", ORDERS))
    rec += [
        ("tie-matrix", "all", ORDERS),
        ("tie-matrix-empty", [1, 2, 3], ORDERS),
        ("simulate-1234", [5], [["frequency", "penetration"]]),
        ("stage-40000", [2], ORDERS),
        ("stage-40000-perm", [2], ORDERS),
        ("retry-35043", [2], ORDERS),
        ("identical-300", [1, 2, 3, 4], FULL_ORDERS),
        ("flood-402", [2], FULL_ORDERS),
        ("runtime-80x202", [2], FULL_ORDERS),
        ("near-42000", [2], ORDERS),
        ("triple-15000", [3], FULL_ORDERS),
        ("triple-60000", [3], FULL_ORDERS),
        ("window-5000", [2], FULL_ORDERS),
        ("gen-diag-100", [1], FULL_ORDERS),
        ("gen-diag-101", [1], FULL_ORDERS),
        ("data-icecream", "all", FULL_ORDERS),
        ("data-ham", "all", FULL_ORDERS),
        ("data-pies", "all", FULL_ORDERS),
        ("data-lunchbags", "all", FULL_ORDERS),
        ("data-chips", [1, 2, 3], FULL_ORDERS),
        ("data-coffee", [1, 2, 3], FULL_ORDERS),
        ("data-cafe", [1, 2, 3], FULL_ORDERS),
    ]
    return rec


def cover_recipes(names):
    rec = sorted(n for n in names if n.startswith(("cover-r-", "random-r-")))
    rec += ["tie-matrix", "tie-matrix-empty", "simulate-1234-300x12",
            "identical-300", "data-ham", "data-icecream", "data-pies",
            "data-lunchbags", "gen-reach-only-3", "gen-reach-only-abc"]
    return rec


SIZES_RECIPES = [
    ("tie-matrix", None, ["frequency", "penetration"]),
    ("tie-matrix", [2, 1], ["frequency", "penetration"]),
    ("tie-matrix", [2, 2], ["penetration", "frequency"]),
    ("tie-matrix-empty", None, []),
    ("simulate-1234-300x12", None, ["frequency", "penetration"]),
    ("simulate-1234-300x12", [3, 1, 2], ["penetration", "frequency"]),
    ("data-ham", None, ["frequency", "penetration"]),
    ("data-pies", [1, 3, 5], ["frequency", "penetration"]),
    ("data-lunchbags", [4, 2], ["penetration"]),
    ("random-r-18", None, ["frequency"]),
    ("random-r-16", None, ["frequency", "penetration"]),
    ("cover-r-5", [1, 1, 2], ["frequency", "penetration"]),
]

W2 = ("The search for the penetration optimum stopped ({reason}). The penetration "
      "is optimal only to within the solver tolerance (about 1e-9).")
W1_PEN = ("The {stage} stage did not finish ({reason}). The portfolio is optimal on "
          "penetration only to within the solver tolerance and may not be optimal on {stage}.")

BOUNDED_RECIPES = [
    {"input": "tie-matrix", "size": 2, "tiebreak": ["penetration", "frequency"],
     "max_pool": 1000, "max_pool_seconds": 0,
     "warnings": [W2.format(reason="time limit of 0 seconds"),
                  W1_PEN.format(stage="frequency", reason="time limit of 0 seconds")],
     "exact": ["reach"]},
    {"input": "tie-matrix", "size": 2, "tiebreak": ["frequency", "penetration"],
     "max_pool": 1000, "max_pool_seconds": 0,
     "warnings": [W2.format(reason="time limit of 0 seconds")],
     "exact": ["reach", "frequency"]},
    {"input": "flood-402", "size": 2, "tiebreak": ["penetration", "frequency"],
     "max_pool": 50, "max_pool_seconds": None,
     "warnings": [W2.format(reason="more than 50 portfolios are within the solver tolerance")],
     "exact": ["reach", "penetration"]},
    {"input": "gen-diag-101", "size": 1, "tiebreak": ["penetration", "frequency"],
     "max_pool": 100, "max_pool_seconds": None,
     "warnings": [W2.format(reason="more than 100 portfolios are within the solver tolerance")],
     "exact": ["reach", "penetration", "frequency"]},
    {"input": "gen-diag-100", "size": 1, "tiebreak": ["penetration", "frequency"],
     "max_pool": 100, "max_pool_seconds": None,
     "warnings": [],
     "exact": ["reach", "penetration", "frequency"]},
]

EXCLUDED_CASES = [
    {"case": "2600 x 202 run-time matrices (plan review, R set.seed(110))",
     "reason": "their results and warnings depend on machine speed (30-second budgets)"},
    {"case": "240000 x 6 triple (N = 80000)",
     "reason": "the penetration gap (7.8e-15 relative) is below the comparison tolerance"},
]


def comparator_cases():
    cases = []
    for size in (1, 2, 3, 8):
        for old in (1024.0, 0.5):
            tol = tolerance(old, size)
            at = old + tol
            assert at - old == tol, "threshold not exact"
            cases += [
                {"size": size, "old": old, "new": old + tol / 2, "worse": False},
                {"size": size, "old": old, "new": at, "worse": False},
                {"size": size, "old": old, "new": math.nextafter(at, math.inf), "worse": True},
                {"size": size, "old": old, "new": old - tol, "worse": False},
                {"size": size, "old": old, "new": old, "worse": False},
            ]
    return cases


# ------------------------------------------------------------- building ----

def build(input_texts):
    mats = {name: Matrix(text) for name, text in input_texts.items()}
    excluded = list(EXCLUDED_CASES)

    turf_cases = []
    for name, sizes, orders in turf_recipes(mats):
        mat = mats[name]
        ks = range(1, len(mat.cand) + 1) if sizes == "all" else sizes
        for k in ks:
            for order in orders:
                cid = "%s/k%d/%s" % (name, k, "+".join(order) or "reach")
                try:
                    exp = optimum(mat, k, order)
                except Excluded as e:
                    excluded.append({"case": cid, "reason": str(e)})
                    continue
                turf_cases.append({"id": cid, "input": name, "size": k,
                                   "tiebreak": order, "expected": exp})

    cover_cases = []
    for name in cover_recipes(mats):
        try:
            exp = min_cover(mats[name])
        except Excluded as e:
            excluded.append({"case": "%s/min_cover" % name, "reason": str(e)})
            continue
        cover_cases.append({"id": "%s/min_cover" % name, "input": name, "expected": exp})

    sizes_cases = []
    for name, sizes, order in SIZES_RECIPES:
        mat = mats[name]
        ks = list(range(1, min_cover(mat)["size"] + 1)) if sizes is None else sizes
        rows = [dict(size=k, **optimum(mat, k, order)) for k in ks]
        cid = "%s/sizes/%s/%s" % (name, "default" if sizes is None else
                                  "-".join(map(str, sizes)), "+".join(order) or "reach")
        sizes_cases.append({"id": cid, "input": name, "sizes": sizes,
                            "tiebreak": order, "expected": rows})

    bounded_cases = []
    for rec in BOUNDED_RECIPES:
        mat = mats[rec["input"]]
        full = optimum(mat, rec["size"], rec["tiebreak"])
        exp = {key: full[key] for key in rec["exact"] if key in full}
        if "frequency" in rec["exact"] and "frequency" not in full:
            exp["frequency"] = optimum(mat, rec["size"], ["frequency"])["frequency"]
        cid = "%s/k%d/%s/pool%s-sec%s" % (rec["input"], rec["size"], "+".join(rec["tiebreak"]),
                                          rec["max_pool"], rec["max_pool_seconds"])
        bounded_cases.append({"id": cid, "input": rec["input"], "size": rec["size"],
                              "tiebreak": rec["tiebreak"], "max_pool": rec["max_pool"],
                              "max_pool_seconds": rec["max_pool_seconds"],
                              "warnings": rec["warnings"], "expected": exp})

    fixtures = {
        "turf.json": {"schema_version": SCHEMA_VERSION, "kind": "turf", "cases": turf_cases},
        "min_cover.json": {"schema_version": SCHEMA_VERSION, "kind": "min_cover",
                           "cases": cover_cases},
        "sizes.json": {"schema_version": SCHEMA_VERSION, "kind": "sizes", "cases": sizes_cases},
        "bounded.json": {"schema_version": SCHEMA_VERSION, "kind": "bounded",
                         "cases": bounded_cases},
        "comparator.json": {"schema_version": SCHEMA_VERSION, "kind": "comparator",
                            "cases": comparator_cases()},
    }
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "inputs": {name: {"sha256": sha256(text), "rows": mats[name].rows,
                          "cols": mats[name].cols,
                          "origin": "generate.py" if name.startswith("gen-") else "export_r.R",
                          "source": json.loads(text)["source"]}
                   for name, text in sorted(input_texts.items())},
        "counts": {k: len(v["cases"]) for k, v in fixtures.items()},
        "excluded": excluded,
    }
    return fixtures, manifest


def dump(obj):
    return json.dumps(obj, indent=1, ensure_ascii=True) + "\n"


def read_inputs(generated):
    texts = {p.stem: p.read_text(encoding="utf-8") for p in sorted(INPUTS.glob("*.json"))
             if not p.stem.startswith("gen-")}
    texts.update(generated)
    return texts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)

    generated = generated_inputs()
    texts = read_inputs(generated)

    if args.check:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        problems = []
        for name, entry in manifest["inputs"].items():
            if name not in texts:
                problems.append("missing input %s" % name)
            elif sha256(texts[name]) != entry["sha256"]:
                problems.append("digest mismatch for input %s" % name)
        for name in texts:
            if name not in manifest["inputs"]:
                problems.append("input %s is not in the manifest" % name)
        for name, text in generated.items():
            path = INPUTS / (name + ".json")
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                problems.append("generated input %s differs" % name)
        if problems:
            print("\n".join(problems))
            return 1

    fixtures, new_manifest = build(texts)

    if args.write:
        INPUTS.mkdir(exist_ok=True)
        FIXTURES.mkdir(exist_ok=True)
        for name, text in generated.items():
            (INPUTS / (name + ".json")).write_text(text, encoding="utf-8")
        for fname, obj in fixtures.items():
            (FIXTURES / fname).write_text(dump(obj), encoding="utf-8")
        MANIFEST.write_text(dump(new_manifest), encoding="utf-8")
        print("wrote %s" % ", ".join("%s: %d" % kv for kv in new_manifest["counts"].items()))
        return 0

    problems = []
    for fname, obj in fixtures.items():
        path = FIXTURES / fname
        if not path.exists() or path.read_text(encoding="utf-8") != dump(obj):
            problems.append("fixture %s differs" % fname)
    if MANIFEST.read_text(encoding="utf-8") != dump(new_manifest):
        problems.append("manifest differs")
    if problems:
        print("\n".join(problems))
        return 1
    print("conformance fixtures are current: %s" %
          ", ".join("%s: %d" % kv for kv in new_manifest["counts"].items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
