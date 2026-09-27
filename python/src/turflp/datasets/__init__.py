"""Example data sets, copied from the turfLP R package.

The values are the raw responses. The R help pages suggest these reach
thresholds: icecream >= 8, chips >= 4, ham >= 7, coffee >= 8; cafe, pies,
and lunchbags are already 0/1. See COPYRIGHTS for sources and licenses.
"""

import csv
from importlib import resources
from typing import NamedTuple

import numpy as np

_NAMES = ("cafe", "chips", "coffee", "ham", "icecream", "lunchbags", "pies")


class Dataset(NamedTuple):
    columns: tuple
    values: np.ndarray


def names():
    """The names of the seven data sets."""
    return _NAMES


def load(name):
    """Load a data set as Dataset(columns, values)."""
    if name not in _NAMES:
        raise ValueError("Unknown data set %r. Use one of: %s." % (name, ", ".join(_NAMES)))
    text = resources.files(__name__).joinpath(name + ".csv").read_text(encoding="utf-8")
    rows = list(csv.reader(text.splitlines()))
    return Dataset(tuple(rows[0]), np.array(rows[1:], dtype=np.int64))
