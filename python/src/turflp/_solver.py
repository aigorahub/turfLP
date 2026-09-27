"""HiGHS through highspy. Mirrors solve_lp() in R/turf.R with the settings of
docs/algorithm.md section 13."""

import math
from dataclasses import dataclass

import highspy
import numpy as np


@dataclass
class Settings:
    # Presolve is the one named difference from R (docs/algorithm.md section 13).
    # Tests switch it off to run the conformance suite a second time.
    presolve: str = "on"


settings = Settings()
# The options of the most recent solve, read back from HiGHS. Tests check them.
last_options = {}

OPTION_NAMES = ("presolve", "mip_rel_gap", "mip_abs_gap", "primal_feasibility_tolerance",
                "mip_feasibility_tolerance", "threads", "time_limit")


class Model:
    """Rows of a linear model, stored so that adding a row copies nothing large.

    `base` holds the rows built once per call (CSR arrays); `extra` holds the
    rows added later (bounds and no-good cuts), as in the R model list.
    """

    def __init__(self, n_vars, base, extra=()):
        self.n_vars = n_vars
        self.base = base            # (start, index, value, lower, upper)
        self.extra = tuple(extra)   # ((index, value, lower, upper), ...)

    def add_row(self, index, value, lower, upper):
        row = (np.asarray(index, dtype=np.int32), np.asarray(value, dtype=np.float64),
               float(lower), float(upper))
        return Model(self.n_vars, self.base, self.extra + (row,))

    def csr(self):
        start, index, value, lower, upper = self.base
        if not self.extra:
            return start, index, value, lower, upper
        starts = [start[:-1]]
        idx = [index]
        val = [value]
        pos = int(start[-1])
        extra_starts = []
        for i, v, _, _ in self.extra:
            extra_starts.append(pos)
            idx.append(i)
            val.append(v)
            pos += len(i)
        starts.append(np.asarray(extra_starts + [pos], dtype=np.int32))
        return (np.concatenate(starts), np.concatenate(idx), np.concatenate(val),
                np.concatenate([lower, [r[2] for r in self.extra]]),
                np.concatenate([upper, [r[3] for r in self.extra]]))


def solve(direction, objective, model, binary, stage, soft=False, time_limit=math.inf):
    """Solve one stage.

    Returns the column values. With `soft`, an infeasible model gives None,
    the time limit gives "time", and any other failure gives "invalid";
    without `soft`, all of these raise RuntimeError.
    """
    n = model.n_vars
    start, index, value, lower, upper = model.csr()
    lp = highspy.HighsLp()
    lp.num_col_ = n
    lp.num_row_ = len(lower)
    lp.col_cost_ = np.asarray(objective, dtype=np.float64)
    col_lower = np.zeros(n)
    col_upper = np.full(n, highspy.kHighsInf)
    col_upper[binary] = 1.0
    lp.col_lower_ = col_lower
    lp.col_upper_ = col_upper
    integrality = [highspy.HighsVarType.kContinuous] * n
    for j in binary:
        integrality[j] = highspy.HighsVarType.kInteger
    lp.integrality_ = integrality
    lp.row_lower_ = np.where(np.isinf(lower), -highspy.kHighsInf, lower)
    lp.row_upper_ = np.where(np.isinf(upper), highspy.kHighsInf, upper)
    lp.a_matrix_.format_ = highspy.MatrixFormat.kRowwise
    lp.a_matrix_.num_col_ = n
    lp.a_matrix_.num_row_ = len(lower)
    lp.a_matrix_.start_ = start
    lp.a_matrix_.index_ = index
    lp.a_matrix_.value_ = value
    lp.sense_ = highspy.ObjSense.kMaximize if direction == "max" else highspy.ObjSense.kMinimize

    h = highspy.Highs()
    h.setOptionValue("output_flag", False)
    h.setOptionValue("presolve", settings.presolve)
    h.setOptionValue("mip_rel_gap", 0.0)
    h.setOptionValue("mip_abs_gap", 0.0)
    h.setOptionValue("primal_feasibility_tolerance", 1e-9)
    h.setOptionValue("mip_feasibility_tolerance", 1e-9)
    h.setOptionValue("threads", 1)
    if math.isfinite(time_limit):
        h.setOptionValue("time_limit", float(time_limit))
    h.passModel(lp)
    h.run()
    last_options.clear()
    for name in OPTION_NAMES:
        value = h.getOptionValue(name)
        # highspy 1.15 returns (status, value).
        last_options[name] = value[1] if isinstance(value, tuple) else value

    status = h.getModelStatus()
    if status == highspy.HighsModelStatus.kOptimal:
        return np.asarray(h.getSolution().col_value, dtype=np.float64)
    # No model here is unbounded, so HiGHS's "unbounded or infeasible" means infeasible.
    infeasible = status in (highspy.HighsModelStatus.kInfeasible,
                            highspy.HighsModelStatus.kUnboundedOrInfeasible)
    if soft:
        if infeasible:
            return None
        if status == highspy.HighsModelStatus.kTimeLimit:
            return "time"
        return "invalid"
    raise RuntimeError("HiGHS did not find a solution in the %s stage (%s)."
                       % (stage, h.modelStatusToString(status)))
