"""Input checks. Mirrors as_reach_matrix(), check_size(), and check_tiebreak()
in R/turf.R; the error texts are those of docs/algorithm.md section 1."""

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


def check_tiebreak(tiebreak):
    if tiebreak is None:
        return []
    if isinstance(tiebreak, str):
        tiebreak = [tiebreak]
    out = []
    for t in tiebreak:
        if t not in CRITERIA:
            raise ValueError('`tiebreak` must contain only "frequency" and "penetration".')
        if t not in out:
            out.append(t)
    return out
