import json
from pathlib import Path

import numpy as np
import pytest

from turflp import _solver

CONFORMANCE = Path(__file__).resolve().parents[2] / "conformance"

TIE = [
    [0, 1, 0, 0, 1],
    [0, 0, 1, 1, 1],
    [0, 0, 1, 1, 0],
    [0, 1, 0, 0, 1],
    [0, 0, 1, 0, 1],
    [1, 0, 0, 1, 0],
    [1, 1, 0, 0, 0],
    [0, 1, 1, 0, 1],
]


def read_input(name):
    """Decode a conformance input (hex columns) to (0/1 array, names)."""
    data = json.loads((CONFORMANCE / "inputs" / (name + ".json")).read_text())
    rows = data["rows"]
    a = np.zeros((rows, data["cols"]), dtype=np.int8)
    for j, h in enumerate(data["columns"]):
        bits = bin(int(h, 16))[2:].zfill(len(h) * 4) if h else ""
        a[:, j] = np.frombuffer(bits[:rows].encode(), dtype=np.uint8) - ord("0")
    return a, data["names"]


def fixtures(kind):
    return json.loads((CONFORMANCE / "fixtures" / (kind + ".json")).read_text())["cases"]


needs_conformance = pytest.mark.skipif(
    not (CONFORMANCE / "fixtures").exists(), reason="conformance/ is not available")


@pytest.fixture(params=["on", "off"], ids=["presolve-on", "presolve-off"])
def presolve(request):
    """Run a test with presolve on and again with presolve off."""
    old = _solver.settings.presolve
    _solver.settings.presolve = request.param
    yield request.param
    _solver.settings.presolve = old
