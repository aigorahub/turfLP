## Update

This is an update of turfLP 0.2.0, which is on CRAN. Changes for R since 0.2.0:

- `turf()`, `turf_min_cover()`, and `turf_sizes()` take `fixed`: column indices of products that the portfolio must contain (0.3.0).
- `turf_sizes()` checks `tiebreak` before `fixed`, and also when `sizes` is empty (0.4.0).
- The help pages explain the search limits, the warnings, and the result fields (0.5.0).

Versions 0.3.0 and 0.4.0 were GitHub releases only. The repository also has Python and JavaScript packages; they are excluded from the R package by `.Rbuildignore`.

## Test environments

- macOS 26 (arm64), R 4.6.1, local
- GitHub Actions: macOS (release), Windows (release), Ubuntu (devel, release, oldrel-1)
- GitHub Actions: Ubuntu 24.04 (release), `R CMD check --as-cran` with the PDF manual
- win-builder: R-devel (2026-10-23 r90760 ucrt) and R-release (4.6.1), `R CMD check --as-cran`

## R CMD check results

- win-builder, R-devel and R-release: Status OK (0 errors | 0 warnings | 0 notes).
- Local macOS, `R CMD check --as-cran --no-manual`: Status OK.
- GitHub Actions, Ubuntu 24.04 (release), `--as-cran` with the PDF manual: 0 errors | 0 warnings |
  1 note. The note is about the HTML manual: the runner has no HTML Tidy and no V8, so R skips
  HTML validation and math rendering. The PDF manual builds without problems.
- GitHub Actions, macOS, Windows and Ubuntu matrix: 0 errors | 0 warnings | 0 notes.

## Reverse dependencies

There are no reverse dependencies on CRAN.

## Data

The package includes four example data sets from public sources: `ham`, `pies`, and `lunchbags` under CC BY 4.0, and `coffee` under CC0 1.0. The `Copyright` field in DESCRIPTION points to `inst/COPYRIGHTS`, which gives the source, license, and changes for each. The help page of each data set gives the same attribution.
