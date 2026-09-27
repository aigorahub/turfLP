"""Ports of tests/testthat/test-turf.R. The R simulator and print() tests stay
R-only; R-seeded matrices come from the frozen conformance inputs."""

import math
import warnings

import numpy as np
import pytest

from turflp import TurfWarning, turf, turf_min_cover, turf_sizes

from conftest import TIE, needs_conformance, read_input


def brute_values(a, k, order):
    """Exact lexicographic optimum values by enumeration (small matrices only)."""
    from fractions import Fraction
    from itertools import combinations
    a = np.asarray(a)
    r = a.sum(axis=0)
    cand = [j for j in range(a.shape[1]) if r[j] > 0]
    combos = list(combinations(cand, k))
    reach = {c: int((a[:, list(c)].sum(axis=1) > 0).sum()) for c in combos}
    best = max(reach.values())
    keep = [c for c in combos if reach[c] == best]
    out = {"reach": best}
    for crit in order:
        if crit == "frequency":
            v = {c: int(r[list(c)].sum()) for c in keep}
            b = max(v.values())
        else:
            v = {c: sum(Fraction(1, int(r[j])) for j in c) for c in keep}
            b = min(v.values())
        keep = [c for c in keep if v[c] == b]
        out[crit] = b if crit == "frequency" else float(k / b)
    return out


@needs_conformance
def test_simulated_example_gives_the_brute_force_optimum():
    a, _ = read_input("simulate-1234")
    p = turf(a, 5)
    assert p.products == (4, 13, 15, 27, 28)
    assert p.names == ("P5", "P14", "P16", "P28", "P29")
    assert p.reach == 948
    assert p.frequency == 2174
    assert p.reach_prop == 0.948


def test_tiebreaks_apply_in_order():
    assert turf(TIE, 2, []).reach == 7
    p = turf(TIE, 2, ["frequency"])
    assert (p.reach, p.frequency) == (7, 8)
    assert p.products in ((1, 2), (3, 4))
    p = turf(TIE, 2)
    assert p.products == (1, 2)
    assert p.frequency == 8
    assert p.penetration == 4


@needs_conformance
@pytest.mark.parametrize("seed", [16, 62, 361] + list(range(1, 41)))
def test_matches_brute_force_on_random_matrices(seed):
    a, _ = read_input("random-r-%d" % seed)
    orders = [[], ["frequency"], ["penetration"],
              ["frequency", "penetration"], ["penetration", "frequency"]]
    for k in range(1, int((a.sum(axis=0) > 0).sum()) + 1):
        for order in orders:
            b = brute_values(a, k, order)
            p = turf(a, k, order)
            assert p.reach == b["reach"]
            if "frequency" in order:
                assert p.frequency == b["frequency"]
            if "penetration" in order:
                assert math.isclose(p.penetration, b["penetration"], rel_tol=1e-12)


@needs_conformance
def test_min_cover_finds_the_smallest_full_cover():
    a, _ = read_input("simulate-1234")
    cover = turf_min_cover(a)
    assert cover.size == 12
    assert cover.reach == 1000
    assert turf(a, 11).reach < 1000
    for seed in range(1, 31):
        a, _ = read_input("cover-r-%d" % seed)
        cover = turf_min_cover(a)
        reachable = int((a.sum(axis=1) > 0).sum())
        assert cover.reach == reachable
        if cover.size > 1:
            assert brute_values(a, cover.size - 1, [])["reach"] < reachable


@needs_conformance
def test_turf_sizes_returns_one_row_per_size():
    a, _ = read_input("simulate-1234-300x12")
    rows = turf_sizes(a)
    cover = turf_min_cover(a)
    assert [p.size for p in rows] == list(range(1, cover.size + 1))
    assert all(x.reach <= y.reach for x, y in zip(rows, rows[1:]))
    assert rows[-1].reach == int((a.sum(axis=1) > 0).sum())
    assert rows[2].reach == turf(a, 3).reach


def test_respondents_and_products_with_no_reach_are_handled():
    a = np.vstack([np.array(TIE), np.zeros((2, 5))])
    a = np.hstack([a, np.zeros((10, 1))])
    p = turf(a, 2)
    assert p.products == (1, 2)
    assert p.respondents == 10
    assert p.reach_prop == 0.7
    with pytest.raises(ValueError, match="only 5 products"):
        turf(a, 6)


def test_logical_matrices_and_data_frames_give_the_same_result():
    pd = pytest.importorskip("pandas")
    p = turf(TIE, 2)
    assert turf(np.array(TIE) == 1, 2).products == p.products
    df = pd.DataFrame(TIE, columns=["a", "b", "c", "d", "e"])
    q = turf(df, 2)
    assert q.products == p.products
    assert q.names == ("b", "c")
    assert turf(np.array(TIE, dtype=np.int64), 2).products == p.products


def test_bad_input_gives_clear_errors():
    with pytest.raises(TypeError, match="numeric or logical"):
        turf([["a", "b"]], 1)
    with pytest.raises(ValueError, match="at least one row"):
        turf(np.zeros((0, 3)), 1)
    with pytest.raises(ValueError, match="missing values"):
        turf([[1, None], [0, 1]], 1)
    with pytest.raises(ValueError, match="missing values"):
        turf(np.array([[1.0, np.nan]]), 1)
    with pytest.raises(ValueError, match="only 0 and 1"):
        turf([[1, 2]], 1)
    with pytest.raises(ValueError, match="single whole number"):
        turf(TIE, 1.5)
    with pytest.raises(ValueError, match="single whole number"):
        turf(TIE, True)
    with pytest.raises(ValueError, match="frequency"):
        turf(TIE, 2, ["reach"])
    with pytest.raises(TypeError, match="frequency"):
        turf(TIE, 2, 3)
    with pytest.raises(ValueError, match="only 0 products"):
        turf(np.zeros((3, 3)), 1)
    with pytest.raises(ValueError, match="No product"):
        turf_min_cover(np.zeros((3, 3)))
    with pytest.raises(ValueError, match="one name per column"):
        turf(TIE, 2, names=["x"])


@needs_conformance
def test_a_later_stage_cannot_make_an_earlier_criterion_worse():
    a, _ = read_input("stage-40000")
    p = turf(a, 2, ["penetration", "frequency"])
    assert p.products == (0, 1)
    assert p.penetration == 20000


@needs_conformance
def test_a_retried_stage_finds_the_true_optimum_on_the_later_criterion():
    a, _ = read_input("retry-35043")
    p = turf(a, 2, ["penetration", "frequency"])
    assert p.products == (2, 3)
    assert p.frequency == 42720


@needs_conformance
def test_identical_products_do_not_flood_the_penetration_stage():
    a, _ = read_input("identical-300")
    with warnings.catch_warnings():
        warnings.simplefilter("error", TurfWarning)
        p = turf(a, 3)
    b = brute_values(a, 3, ["frequency", "penetration"])
    assert (p.reach, p.frequency) == (b["reach"], b["frequency"])
    assert math.isclose(p.penetration, b["penetration"], rel_tol=1e-12)


@needs_conformance
def test_many_exact_ties_on_penetration_keep_the_frequency_optimum():
    a, _ = read_input("flood-402")
    with warnings.catch_warnings():
        warnings.simplefilter("error", TurfWarning)
        p = turf(a, 2, ["penetration", "frequency"], max_pool_seconds=math.inf)
    assert p.products == (400, 401)
    with pytest.warns(TurfWarning, match="penetration optimum stopped"):
        p = turf(a, 2, ["penetration", "frequency"], max_pool=50, max_pool_seconds=math.inf)
    assert p.products == (400, 401)


@needs_conformance
def test_penetration_differences_near_1e_13_are_not_treated_as_ties():
    a, _ = read_input("near-42000")
    assert turf(a, 2, ["penetration", "frequency"]).products == (0, 1)


def test_limits_are_checked_before_solving():
    for bad in (float("nan"), -1, 1.5):
        with pytest.raises((ValueError, TypeError)):
            turf(TIE, 2, max_pool=bad)
    with pytest.raises(TypeError):
        turf(TIE, 2, max_pool="5")
    for bad in (float("nan"), -0.5):
        with pytest.raises(ValueError):
            turf(TIE, 2, max_pool_seconds=bad)
        with pytest.raises(ValueError):
            turf_sizes(TIE, [1], max_pool_seconds=bad)
    with pytest.warns(TurfWarning, match="more than 0 portfolios"):
        assert turf(TIE, 2, max_pool=0, max_pool_seconds=math.inf).reach == 7


def test_the_pool_time_limit_gives_a_warning_and_a_valid_portfolio():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        p = turf(TIE, 2, ["penetration", "frequency"], max_pool_seconds=0)
    texts = [str(w.message) for w in caught if issubclass(w.category, TurfWarning)]
    assert texts and all("time limit" in t for t in texts)
    assert p.reach == brute_values(TIE, 2, ["penetration"])["reach"]


def test_many_tied_portfolios_give_no_warning_when_the_pool_is_complete():
    with warnings.catch_warnings():
        warnings.simplefilter("error", TurfWarning)
        p = turf(np.eye(101), 1, ["penetration", "frequency"])
    assert p.reach == 1
