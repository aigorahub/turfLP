"""TURF analysis (total unduplicated reach and frequency) with integer linear
programming. Python port of the turfLP R package; see docs/algorithm.md in
https://github.com/aigorahub/turfLP for the specification."""

from ._core import Portfolio, TurfWarning, turf, turf_min_cover, turf_sizes

__all__ = ["Portfolio", "TurfWarning", "turf", "turf_min_cover", "turf_sizes"]
__version__ = "0.1.0"
