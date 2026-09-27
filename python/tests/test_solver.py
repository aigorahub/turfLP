"""Solver settings and the failure paths of docs/algorithm.md section 6."""

import warnings

import numpy as np
import pytest

import turflp
from turflp import TurfWarning, _solver, turf

from conftest import TIE

EXPECTED = {
    "mip_rel_gap": 0.0,
    "mip_abs_gap": 0.0,
    "primal_feasibility_tolerance": 1e-9,
    "mip_feasibility_tolerance": 1e-9,
    "threads": 1,
}


def record_options(monkeypatch):
    seen = []
    real = _solver.solve

    def wrapper(*args, **kwargs):
        out = real(*args, **kwargs)
        seen.append(dict(_solver.last_options))
        return out

    monkeypatch.setattr(_solver, "solve", wrapper)
    return seen


def test_every_solve_uses_the_documented_settings(monkeypatch, presolve):
    seen = record_options(monkeypatch)
    turf(TIE, 2, ["penetration", "frequency"])
    turflp.turf_min_cover(TIE)
    assert len(seen) >= 4
    for opts in seen:
        for name, value in EXPECTED.items():
            assert opts[name] == value, name
        assert opts["presolve"] == presolve


def test_solver_versions_are_reported():
    import highspy
    version = highspy.Highs().version()
    print("highspy HiGHS version", version)
    assert tuple(int(x) for x in version.split(".")[:2]) >= (1, 15)


def fake_solver(monkeypatch, script):
    """Replace the solver after the first (reach) solve with scripted answers."""
    real = _solver.solve
    calls = {"n": 0}

    def wrapper(direction, objective, model, binary, stage, soft=False, time_limit=None):
        calls["n"] += 1
        if calls["n"] == 1:
            return real(direction, objective, model, binary, stage, soft=soft)
        return script(model, binary, calls["n"])

    monkeypatch.setattr(_solver, "solve", wrapper)
    return calls


def caught_warnings(fn):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = fn()
    return result, [str(w.message) for w in caught if issubclass(w.category, TurfWarning)]


def test_timeout_path(monkeypatch):
    fake_solver(monkeypatch, lambda model, binary, n: "time")
    p, texts = caught_warnings(lambda: turf(TIE, 2, ["frequency"]))
    assert p.reach == 7
    assert texts == ["The frequency stage did not finish (time limit of 30 seconds). The "
                     "portfolio is optimal on the earlier criteria but may not be optimal on "
                     "frequency."]


def test_infeasible_path(monkeypatch):
    fake_solver(monkeypatch, lambda model, binary, n: None)
    p, texts = caught_warnings(lambda: turf(TIE, 2, ["frequency"]))
    assert p.reach == 7
    assert texts == ["The frequency stage did not finish (HiGHS found no valid portfolio). "
                     "The portfolio is optimal on the earlier criteria but may not be optimal "
                     "on frequency."]


def test_invalid_vector_path(monkeypatch):
    def three_products(model, binary, n):
        x = np.zeros(model.n_vars)
        x[binary[:3]] = 1.0
        return x
    fake_solver(monkeypatch, three_products)
    p, texts = caught_warnings(lambda: turf(TIE, 2, ["frequency"]))
    assert p.reach == 7
    assert "HiGHS returned an invalid solution" in texts[0]


def test_invalid_first_stage_is_an_error(monkeypatch):
    monkeypatch.setattr(_solver, "solve",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("HiGHS did not "
                                                                           "find a solution")))
    with pytest.raises(RuntimeError):
        turf(TIE, 2)


def test_retry_limit_path(monkeypatch):
    # Always return products 1 and 4 (0-based 0 and 3), which reach only 4
    # respondents: worse on reach than the first stage's 7.
    def worse(model, binary, n):
        x = np.zeros(model.n_vars)
        x[binary[[0, 3]]] = 1.0
        return x
    calls = fake_solver(monkeypatch, worse)
    p, texts = caught_warnings(lambda: turf(TIE, 2, ["frequency"]))
    assert p.reach == 7
    assert calls["n"] == 1 + 100
    assert texts == ["The frequency stage did not finish (100 solves). The portfolio is "
                     "optimal on the earlier criteria but may not be optimal on frequency."]
