"""The turfLP algorithm. Mirrors R/turf.R; docs/algorithm.md is the spec.

Section numbers in comments refer to docs/algorithm.md.
"""

import math
import time
import warnings
from dataclasses import dataclass

import numpy as np

from . import _solver
from ._input import as_reach_matrix, check_limits, check_size, check_tiebreak

EPS = 2.0 ** -52
MAX_SOLVES = 100
DEFAULT_TIEBREAK = ("frequency", "penetration")


class TurfWarning(UserWarning):
    """A search stopped before it proved the full optimum (docs/algorithm.md section 10)."""


@dataclass(frozen=True)
class Portfolio:
    """A selected portfolio. `products` are 0-based column indices, ascending."""
    products: tuple
    names: tuple
    size: int
    reach: int
    reach_prop: float
    frequency: int
    penetration: float
    respondents: int


# Section 5: the comparison rule.
def tolerance(value, size):
    return 16 * size * EPS * max(1.0, abs(value))


def signed_value(obj, selected):
    return (1 if obj["direction"] == "min" else -1) * obj["value"](selected)


def worse_on_earlier(objectives, selected, previous, size):
    for obj in objectives:
        new = signed_value(obj, selected)
        old = signed_value(obj, previous)
        if new > old + tolerance(old, size):
            return True
        if new < old - tolerance(old, size):
            return False
    return False


def best_of(pool, objectives, size):
    keep = list(range(len(pool)))
    for obj in objectives:
        v = [signed_value(obj, pool[i]) for i in keep]
        lo = min(v)
        keep = [i for i, x in zip(keep, v) if x <= lo + tolerance(lo, size)]
    return pool[keep[0]]


def _warn(text):
    warnings.warn(text, TurfWarning, stacklevel=3)


def _format_seconds(x):
    # R formats the budget with %g.
    return "%g" % x


def _portfolio(reach, names, products):
    products = sorted(int(p) for p in products)
    r = reach[:, products].sum(axis=0) if products else np.zeros(0)
    reached = int(np.any(reach[:, products] > 0, axis=1).sum()) if products else 0
    k = len(products)
    return Portfolio(
        products=tuple(products),
        names=tuple(names[p] for p in products),
        size=k,
        reach=reached,
        reach_prop=reached / reach.shape[0],
        frequency=int(r.sum()),
        penetration=k / math.fsum(1.0 / x for x in r),
        respondents=int(reach.shape[0]),
    )


def turf(reach, size, tiebreak=DEFAULT_TIEBREAK, *, names=None, max_pool=1000,
         max_pool_seconds=30.0):
    """Find the portfolio of `size` products with maximum reach.

    Ties on reach are broken by the criteria in `tiebreak`, in order
    ("frequency", "penetration", or an empty sequence for reach only).
    Returns a Portfolio. Emits TurfWarning when a search stops early.
    """
    reach, names = as_reach_matrix(reach, names)
    tiebreak = check_tiebreak(tiebreak)
    check_limits(max_pool, max_pool_seconds)
    return _turf(reach, names, size, tiebreak, max_pool, max_pool_seconds)


def _turf(reach, names, size, tiebreak, max_pool, max_pool_seconds):
    # Section 2: reduction.
    prod_reach = reach.sum(axis=0)
    cand = np.flatnonzero(prod_reach > 0)
    size = check_size(size, len(cand))
    a = reach[np.ix_(reach[:, cand].sum(axis=1) > 0, cand)]
    n, m = a.shape
    x_vars = np.arange(n, n + m)
    n_vars = n + m + 1
    cand_reach = prod_reach[cand]
    pen_coef = cand_reach.max() / cand_reach

    # Section 3: the model.
    rows_i, cols_j = np.nonzero(a)
    counts = np.bincount(rows_i, minlength=n)
    start = np.zeros(n + 3, dtype=np.int32)
    start[1:n + 1] = np.cumsum(counts + 1)
    index = np.empty(int(start[n]), dtype=np.int32)
    value = np.ones(int(start[n]))
    # Respondent row i: z_i + sum_j a_ij x_j >= 1 (z_i first, then x_j in column order).
    pos = start[:n].copy()
    index[pos] = np.arange(n)
    pos += 1
    order = np.lexsort((cols_j, rows_i))
    fill = np.repeat(pos, counts) + (np.arange(len(order)) - np.repeat(np.cumsum(counts) - counts, counts))
    index[fill] = n + cols_j[order]
    index = np.concatenate([index, x_vars, x_vars, [n_vars - 1]]).astype(np.int32)
    value = np.concatenate([value, np.ones(m), -pen_coef, [1.0]])
    start[n + 1] = start[n] + m
    start[n + 2] = start[n + 1] + m + 1
    lower = np.concatenate([np.ones(n), [size, 0.0]])
    upper = np.concatenate([np.full(n, np.inf), [size, 0.0]])
    model = _solver.Model(n_vars, (start, index, value, lower, upper))

    def on_x(coef):
        return x_vars, np.asarray(coef, dtype=np.float64)

    # Symmetry rows for identical products.
    keys = [tuple(np.flatnonzero(a[:, j])) for j in range(m)]
    last_seen = {}
    for j, key in enumerate(keys):
        if key in last_seen:
            model = model.add_row([n + last_seen[key], n + j], [1.0, -1.0], 0.0, math.inf)
        last_seen[key] = j

    # Section 4: criteria. `sel` is a boolean vector over the candidates.
    def reach_value(sel):
        return n - int(np.any(a[:, sel] > 0, axis=1).sum())

    z_coef = np.concatenate([np.ones(n), np.zeros(m + 1)])
    objectives = {
        "reach": {"name": "reach", "direction": "min", "coef": z_coef,
                  "row": (np.arange(n), np.ones(n)), "value": reach_value},
        "frequency": {"name": "frequency", "direction": "max",
                      "coef": np.concatenate([np.zeros(n), cand_reach, [0.0]]),
                      "row": on_x(cand_reach),
                      "value": lambda sel: int(cand_reach[sel].sum())},
        "penetration": {"name": "penetration", "direction": "min",
                        "coef": np.concatenate([np.zeros(n + m), [1.0]]),
                        "row": (np.array([n_vars - 1]), np.array([1.0])),
                        "value": lambda sel: math.fsum(pen_coef[sel])},
    }

    def add_bound(model, obj, rhs):
        idx, val = obj["row"]
        if obj["direction"] == "min":
            return model.add_row(idx, val, -math.inf, rhs)
        return model.add_row(idx, val, rhs, math.inf)

    def exclude(model, sel):
        return model.add_row(x_vars[sel], np.ones(int(sel.sum())), -math.inf, size - 1)

    # Section 6: one stage with checks.
    def next_valid(model, obj, earlier, previous, deadline=math.inf):
        for _ in range(MAX_SOLVES):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return "time", None, model
            sol = _solver.solve(obj["direction"], obj["coef"], model, x_vars, obj["name"],
                                soft=previous is not None, time_limit=remaining)
            if sol is None:
                return "none", None, model
            if isinstance(sol, str):
                if sol == "time":
                    return "time", None, model
                if previous is None:
                    raise RuntimeError("HiGHS returned an invalid solution in the %s stage."
                                       % obj["name"])
                return "invalid", None, model
            x = sol[x_vars]
            sel = x > 0.5
            if (np.isnan(x).any() or int(sel.sum()) != size
                    or np.any(np.abs(x - sel) > 1e-6)):
                if previous is None:
                    raise RuntimeError("HiGHS returned an invalid solution in the %s stage."
                                       % obj["name"])
                return "invalid", None, model
            if previous is None or not worse_on_earlier(earlier, sel, previous, size):
                return "ok", sel, model
            model = exclude(model, sel)
        return "limit", None, model

    def reason(status):
        return {"limit": "%d solves" % MAX_SOLVES,
                "time": "time limit of %s seconds" % _format_seconds(max_pool_seconds),
                "invalid": "HiGHS returned an invalid solution",
                "none": "HiGHS found no valid portfolio",
                "full": "more than %d portfolios are within the solver tolerance" % max_pool,
                }[status]

    def unfinished(stage, status, earlier_exact=True):
        middle = ("the earlier criteria but" if earlier_exact else
                  "penetration only to within the solver tolerance and")
        _warn("The %s stage did not finish (%s). The portfolio is optimal on %s may not "
              "be optimal on %s." % (stage, reason(status), middle, stage))

    # Section 7: the stage loop.
    stages = ["reach"] + list(tiebreak)
    previous = None
    selected = None
    for s, stage in enumerate(stages):
        obj = objectives[stage]
        earlier = [objectives[t] for t in stages[:s]]
        status, sel, new_model = next_valid(model, obj, earlier, previous)
        if status != "ok":
            unfinished(stage, status)
            break
        model = new_model
        selected = sel

        if stage == "penetration":
            # Section 8: the penetration stage.
            without_pool = model
            bound = obj["value"](selected)
            pool = [selected]
            last = selected
            model = add_bound(model, obj, bound)
            pool_status = "full"
            deadline = time.monotonic() + max_pool_seconds
            for _ in range(max_pool):
                model = exclude(model, last)
                status, sel, model = next_valid(model, obj, earlier, previous, deadline)
                if status != "ok":
                    pool_status = "complete" if status == "none" else status
                    break
                last = sel
                # Skip products that meet the bound only within the solver tolerance.
                if obj["value"](last) <= bound + tolerance(bound, size):
                    pool.append(last)

            if pool_status == "complete":
                selected = best_of(pool, [objectives[t] for t in stages[s:]], size)
            else:
                _warn("The search for the penetration optimum stopped (%s). The penetration "
                      "is optimal only to within the solver tolerance (about 1e-9)."
                      % reason(pool_status))
                selected = best_of(pool, [obj], size)
                if s + 1 < len(stages):
                    later = objectives[stages[s + 1]]
                    status, sel, _ = next_valid(
                        add_bound(without_pool, obj, obj["value"](selected)),
                        later, [objectives[t] for t in stages[:s + 1]], selected,
                        time.monotonic() + max_pool_seconds)
                    if status == "ok":
                        selected = sel
                    else:
                        unfinished(stages[s + 1], status, earlier_exact=False)
            break

        previous = selected
        if s + 1 < len(stages):
            # Fix this criterion at the value the selected products give.
            model = add_bound(model, obj, obj["value"](selected))

    return _portfolio(reach, names, cand[selected])


def turf_min_cover(reach, *, names=None):
    """Find the smallest portfolio that reaches every reachable respondent."""
    reach, names = as_reach_matrix(reach, names)
    return _min_cover(reach, names)


def _min_cover(reach, names):
    cand = np.flatnonzero(reach.sum(axis=0) > 0)
    if len(cand) == 0:
        raise ValueError("No product reaches any respondent.")
    a = reach[np.ix_(reach[:, cand].sum(axis=1) > 0, cand)]
    n, m = a.shape
    rows_i, cols_j = np.nonzero(a)
    order = np.lexsort((cols_j, rows_i))
    counts = np.bincount(rows_i, minlength=n)
    start = np.concatenate([[0], np.cumsum(counts)]).astype(np.int32)
    model = _solver.Model(m, (start, cols_j[order].astype(np.int32), np.ones(len(order)),
                              np.ones(n), np.full(n, np.inf)))
    sol = _solver.solve("min", np.ones(m), model, np.arange(m), "set cover")
    sel = sol > 0.5
    # Section 11: check the cover.
    if not np.all(np.any(a[:, sel] > 0, axis=1)) or np.any(np.abs(sol - sel) > 1e-6):
        raise RuntimeError("HiGHS returned an invalid solution in the set cover stage.")
    return _portfolio(reach, names, cand[sel])


def turf_sizes(reach, sizes=None, tiebreak=DEFAULT_TIEBREAK, *, names=None, max_pool=1000,
               max_pool_seconds=30.0):
    """Solve `turf` for each size and return a list of Portfolio values.

    The default sizes are 1 to the size of the minimum cover.
    """
    reach, names = as_reach_matrix(reach, names)
    tiebreak = check_tiebreak(tiebreak)
    check_limits(max_pool, max_pool_seconds)
    if sizes is None:
        sizes = range(1, _min_cover(reach, names).size + 1)
    return [_turf(reach, names, k, tiebreak, max_pool, max_pool_seconds) for k in sizes]
