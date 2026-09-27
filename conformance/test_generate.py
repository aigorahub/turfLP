#!/usr/bin/env python3
"""Hand-checked tests for conformance/generate.py. Standard library only.

    python3 conformance/test_generate.py
"""

import math
import sys
import unittest
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate as g  # noqa: E402


def matrix(columns, names=None):
    return g.Matrix(g.input_json("t", "test", columns, names))


TIE = [  # tests/testthat/test-turf.R tie_matrix, by column
    [0, 0, 0, 0, 0, 1, 1, 0],
    [1, 0, 0, 1, 0, 0, 1, 1],
    [0, 1, 1, 0, 1, 0, 0, 1],
    [0, 1, 1, 0, 0, 1, 0, 0],
    [1, 1, 0, 1, 1, 0, 0, 1],
]


class HexTest(unittest.TestCase):
    def test_round_trip(self):
        cols = [[1, 0, 1, 1, 0], [0, 0, 0, 0, 1], [1, 1, 1, 1, 1]]
        m = matrix(cols)
        for j, col in enumerate(cols):
            self.assertEqual([(m.columns[j] >> i) & 1 for i in range(5)], col)
        self.assertEqual(g.hex_column([0, 0, 0, 0, 0, 1, 1, 0]), "06")
        self.assertEqual(m.reach, [3, 1, 5])

    def test_padding_bits_rejected(self):
        text = g.input_json("t", "test", [[1, 0, 1]]).replace('"a"', '"b"')
        with self.assertRaises(ValueError):
            g.Matrix(text)


class OptimumTest(unittest.TestCase):
    def test_tie_matrix(self):
        m = matrix(TIE)
        self.assertEqual(g.optimum(m, 2, []), {"reach": 7})
        self.assertEqual(g.optimum(m, 2, ["frequency"]), {"reach": 7, "frequency": 8})
        full = g.optimum(m, 2, ["frequency", "penetration"])
        self.assertEqual(full["penetration"]["fraction"], "4/1")
        self.assertEqual(full["penetration"]["value"], 4.0)

    def test_reach_only_has_no_secondary_values(self):
        # A = 111, B = 100, C = 110: A+B and A+C both reach 3.
        m = matrix([[1, 1, 1], [1, 0, 0], [1, 1, 0]], ["A", "B", "C"])
        self.assertEqual(g.optimum(m, 2, []), {"reach": 3})
        self.assertEqual(g.optimum(m, 2, ["frequency"])["frequency"], 5)
        # A+B: 2 / (1/3 + 1) = 1.5; A+C: 2 / (1/3 + 1/2) = 2.4.
        pen = g.optimum(m, 2, ["penetration"])["penetration"]
        self.assertEqual(pen["fraction"], "12/5")

    def test_near_tie_rule(self):
        # The two full-reach triples of the 240,000-respondent review case:
        # reaches (N-1, N-1, N+2) and (N-2, N+1, N+1) with N = 80000 differ by
        # 7.8e-15 (relative), below the tolerance; with N = 20000 they differ
        # by 5e-13, above it.
        for n, close in ((80000, True), (20000, False)):
            a = Fraction(2, n - 1) + Fraction(1, n + 2)
            b = Fraction(1, n - 2) + Fraction(2, n + 1)
            best, other = min(a, b), max(a, b)
            self.assertEqual(g.near_tie(best, other, n + 2, 3), close, n)
        self.assertFalse(g.near_tie(Fraction(1, 3), Fraction(1, 3), 3, 2))

    def test_empty_rows_and_columns(self):
        cols = [c + [0, 0] for c in TIE] + [[0] * 10]
        m = matrix(cols)
        self.assertEqual(m.cand, [0, 1, 2, 3, 4])
        self.assertEqual(g.optimum(m, 2, ["frequency", "penetration"])["reach"], 7)
        self.assertEqual(m.reachable, 8)


class CoverTest(unittest.TestCase):
    def test_min_cover(self):
        self.assertEqual(g.min_cover(matrix([[1, 1], [1, 0], [0, 1]])),
                         {"size": 1, "reachable": 2})
        # Every product reaches one respondent, so all are needed.
        diag = [[1 if i == j else 0 for i in range(4)] for j in range(4)]
        self.assertEqual(g.min_cover(matrix(diag)), {"size": 4, "reachable": 4})

    def test_no_reach(self):
        with self.assertRaises(g.Excluded):
            g.min_cover(matrix([[0, 0], [0, 0]]))


class ComparatorTest(unittest.TestCase):
    def test_threshold_is_exact(self):
        for case in g.comparator_cases():
            tol = g.tolerance(case["old"], case["size"])
            worse = case["new"] > case["old"] + tol
            self.assertEqual(worse, case["worse"], case)

    def test_tolerance_formula(self):
        self.assertEqual(g.tolerance(1024.0, 1), 2.0 ** -38)
        self.assertEqual(g.tolerance(0.5, 2), 32 * 2.0 ** -52)
        self.assertTrue(math.isclose(g.tolerance(-10.0, 3), 480 * 2.0 ** -52))


class FixtureTest(unittest.TestCase):
    def test_fixtures_are_current(self):
        self.assertEqual(g.main(["--check"]), 0)

    def test_penetration_value_matches_fraction(self):
        import json
        cases = json.loads((g.FIXTURES / "turf.json").read_text())["cases"]
        for c in cases:
            pen = c["expected"].get("penetration")
            if pen:
                num, den = map(int, pen["fraction"].split("/"))
                self.assertEqual(float(Fraction(num, den)), pen["value"], c["id"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
