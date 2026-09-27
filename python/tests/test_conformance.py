"""The shared conformance suite (conformance/README.md), with presolve on and off."""

import math
import warnings
from fractions import Fraction
from functools import lru_cache

import pytest

from turflp import TurfWarning, _core, turf, turf_min_cover, turf_sizes

from conftest import fixtures, needs_conformance, read_input

pytestmark = needs_conformance
INF = math.inf


@lru_cache(maxsize=None)
def matrix(name):
    return read_input(name)


def check_fields(a, names, p):
    """Rule 2: every reported field equals its recomputation from the indices."""
    sel = list(p.products)
    assert len(set(sel)) == len(sel) == p.size
    assert list(p.names) == [names[j] for j in sel]
    r = a[:, sel].sum(axis=0)
    reached = int((a[:, sel].sum(axis=1) > 0).sum())
    assert p.reach == reached
    assert p.respondents == a.shape[0]
    assert p.reach_prop == reached / a.shape[0]
    assert p.frequency == int(r.sum())
    assert math.isclose(p.penetration, p.size / sum(1.0 / x for x in r), rel_tol=1e-12)


def exact_penetration(a, p):
    r = a[:, list(p.products)].sum(axis=0)
    return Fraction(p.size) / sum(Fraction(1, int(x)) for x in r)


def check_expected(a, p, expected):
    assert p.reach == expected["reach"]
    if "frequency" in expected:
        assert p.frequency == expected["frequency"]
    if "penetration" in expected:
        assert exact_penetration(a, p) == Fraction(expected["penetration"]["fraction"])


def turf_ids(case):
    return case["id"]


@pytest.mark.parametrize("case", fixtures("turf"), ids=turf_ids)
def test_turf(case, presolve):
    a, names = matrix(case["input"])
    with warnings.catch_warnings():
        warnings.simplefilter("error", TurfWarning)
        p = turf(a, case["size"], case["tiebreak"], names=names, max_pool_seconds=INF)
    check_fields(a, names, p)
    check_expected(a, p, case["expected"])


@pytest.mark.parametrize("case", fixtures("min_cover"), ids=turf_ids)
def test_min_cover(case, presolve):
    a, names = matrix(case["input"])
    p = turf_min_cover(a, names=names)
    check_fields(a, names, p)
    assert p.size == case["expected"]["size"]
    assert p.reach == case["expected"]["reachable"]


@pytest.mark.parametrize("case", fixtures("sizes"), ids=turf_ids)
def test_sizes(case, presolve):
    a, names = matrix(case["input"])
    rows = turf_sizes(a, case["sizes"], case["tiebreak"], names=names, max_pool_seconds=INF)
    assert [p.size for p in rows] == [e["size"] for e in case["expected"]]
    for p, e in zip(rows, case["expected"]):
        check_fields(a, names, p)
        check_expected(a, p, e)


@pytest.mark.parametrize("case", fixtures("bounded"), ids=turf_ids)
def test_bounded(case, presolve):
    a, names = matrix(case["input"])
    seconds = INF if case["max_pool_seconds"] is None else case["max_pool_seconds"]
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        p = turf(a, case["size"], case["tiebreak"], names=names,
                 max_pool=case["max_pool"], max_pool_seconds=seconds)
    texts = [str(w.message) for w in caught if issubclass(w.category, TurfWarning)]
    assert texts == case["warnings"]
    check_fields(a, names, p)
    check_expected(a, p, case["expected"])


@pytest.mark.parametrize("case", fixtures("comparator"))
def test_comparator(case):
    obj = {"direction": "min", "value": lambda v: v}
    assert _core.worse_on_earlier([obj], case["new"], case["old"], case["size"]) is case["worse"]
