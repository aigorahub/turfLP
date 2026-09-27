import csv

import numpy as np
import pytest

from turflp import datasets, turf

from conftest import CONFORMANCE, needs_conformance

DIMS = {"icecream": (120, 10), "chips": (600, 24), "cafe": (2500, 40), "ham": (127, 8),
        "coffee": (118, 27), "pies": (980, 10), "lunchbags": (1175, 14)}


def test_all_seven_data_sets_load_with_the_r_dimensions():
    assert set(datasets.names()) == set(DIMS)
    for name, dims in DIMS.items():
        d = datasets.load(name)
        assert d.values.shape == dims
        assert len(d.columns) == dims[1]
        assert d.values.dtype.kind == "i"


@needs_conformance
def test_data_sets_equal_the_r_export():
    for name in DIMS:
        with open(CONFORMANCE / "data" / (name + ".csv"), newline="") as f:
            rows = list(csv.reader(f))
        d = datasets.load(name)
        assert d.columns == tuple(rows[0])
        assert np.array_equal(d.values, np.array(rows[1:], dtype=np.int64))


def test_documented_thresholds_give_the_r_examples():
    ham = datasets.load("ham")
    p = turf(ham.values >= 7, 2, names=ham.columns)
    assert p.names == ("N4", "S1")
    assert p.reach == 98


def test_unknown_data_set():
    with pytest.raises(ValueError, match="Unknown data set"):
        datasets.load("sushi")
