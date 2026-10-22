"""Input checks. Mirrors as_reach_matrix(), check_size(), check_tiebreak(),
check_fixed(), and check_fixed_reach() in R/turf.R; the error texts are those of docs/algorithm.md section 1."""

import math
import numbers

import numpy as np

CRITERIA = ("frequency", "penetration")


def as_reach_matrix(reach, names=None):
    """Return (float 0/1 matrix, list of product names)."""
    columns = None
    if hasattr(reach, "to_numpy") and hasattr(reach, "columns"):
        columns = [str(c) for c in reach.columns]
        reach = reach.to_numpy()
    if isinstance(reach, np.ndarray):
        arr = reach
    elif isinstance(reach, (list, tuple)):
        if not all(isinstance(row, (list, tuple, np.ndarray)) for row in reach):
            raise TypeError("`reach` must be a numeric or logical matrix or data frame.")
        widths = {len(row) for row in reach}
        if len(widths) > 1:
            raise ValueError("`reach` must be a numeric or logical matrix or data frame.")
        arr = np.empty((len(reach), widths.pop() if widths else 0), dtype=object)
        for i, row in enumerate(reach):
            arr[i, :] = list(row)
    else:
        raise TypeError("`reach` must be a numeric or logical matrix or data frame.")

    if arr.ndim != 2:
        raise TypeError("`reach` must be a numeric or logical matrix or data frame.")
    if arr.dtype.kind in "biuf":
        pass
    elif arr.dtype.kind == "O":
        for v in arr.flat:
            if v is None:
                continue
            if isinstance(v, (bool, np.bool_)) or (
                    isinstance(v, numbers.Real) and not isinstance(v, str)):
                continue
            raise TypeError("`reach` must be a numeric or logical matrix or data frame.")
    else:
        raise TypeError("`reach` must be a numeric or logical matrix or data frame.")
    if arr.shape[0] == 0 or arr.shape[1] == 0:
        raise ValueError("`reach` must have at least one row and one column.")
    if arr.dtype.kind == "O":
        if any(v is None or (isinstance(v, float) and math.isnan(v)) for v in arr.flat):
            raise ValueError("`reach` must not contain missing values.")
        arr = arr.astype(np.float64)
    elif arr.dtype.kind == "f" and np.isnan(arr).any():
        raise ValueError("`reach` must not contain missing values.")
    arr = arr.astype(np.float64)
    if not np.all((arr == 0) | (arr == 1)):
        raise ValueError("`reach` must contain only 0 and 1, or FALSE and TRUE.")

    if names is not None:
        names = [str(n) for n in names]
        if len(names) != arr.shape[1]:
            raise ValueError("`names` must have one name per column of `reach`.")
    elif columns is not None:
        names = columns
    else:
        names = ["P%d" % (j + 1) for j in range(arr.shape[1])]
    return arr, names


def check_size(size, max_size):
    ok = (isinstance(size, numbers.Real) and not isinstance(size, (bool, np.bool_))
          and math.isfinite(size) and size >= 1 and size == int(size))
    if not ok:
        raise ValueError("`size` must be a single whole number of 1 or more.")
    size = int(size)
    if size > max_size:
        raise ValueError("`size` is %d, but only %d products reach at least one respondent."
                         % (size, max_size))
    return size


def check_fixed(fixed, cols):
    """The type and range checks of `fixed`. Returns 0-based indices as given,
    so that the zero-reach check names the first bad one."""
    if fixed is None:
        return []
    # A set has no order, so the zero-reach error could name either of two products.
    if isinstance(fixed, (str, bytes, set, frozenset, dict)):
        raise TypeError("`fixed` must be a vector of whole-number product indices.")
    try:
        fixed = list(fixed)
    except TypeError:
        raise TypeError("`fixed` must be a vector of whole-number product indices.") from None
    for j in fixed:
        if not isinstance(j, numbers.Real) or isinstance(j, (bool, np.bool_)):
            raise TypeError("`fixed` must be a vector of whole-number product indices.")
        if not math.isfinite(j) or j != int(j):
            raise ValueError("`fixed` must be a vector of whole-number product indices.")
    if any(j < 0 or j > cols - 1 for j in fixed):
        raise ValueError("`fixed` must hold product indices from 0 to %d." % (cols - 1))
    return [int(j) for j in fixed]


def check_fixed_reach(fixed, prod_reach, names):
    """Every fixed product must reach someone. Returns the distinct indices, sorted."""
    for j in fixed:
        if prod_reach[j] == 0:
            raise ValueError("Fixed product %s reaches no respondent." % names[j])
    return sorted(set(fixed))


def check_tiebreak(tiebreak):
    if tiebreak is None:
        return []
    if isinstance(tiebreak, str):
        tiebreak = [tiebreak]
    try:
        tiebreak = list(tiebreak)
    except TypeError:
        raise TypeError('`tiebreak` must contain only "frequency" and "penetration".') from None
    out = []
    for t in tiebreak:
        if t not in CRITERIA:
            raise ValueError('`tiebreak` must contain only "frequency" and "penetration".')
        if t not in out:
            out.append(t)
    return out


def check_limits(max_pool, max_pool_seconds):
    """Check the limits of docs/algorithm.md section 14 before any solve."""
    if (not isinstance(max_pool, numbers.Integral) or isinstance(max_pool, (bool, np.bool_))):
        raise TypeError("`max_pool` must be a whole number of 0 or more.")
    if max_pool < 0:
        raise ValueError("`max_pool` must be a whole number of 0 or more.")
    if (not isinstance(max_pool_seconds, numbers.Real)
            or isinstance(max_pool_seconds, (bool, np.bool_))):
        raise TypeError("`max_pool_seconds` must be a number of 0 or more (math.inf for no limit).")
    if math.isnan(max_pool_seconds) or max_pool_seconds < 0:
        raise ValueError("`max_pool_seconds` must be a number of 0 or more (math.inf for no limit).")
