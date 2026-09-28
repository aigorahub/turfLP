## Resubmission

This is a resubmission. The incoming pretests of the first submission gave two NOTEs:

- Examples with elapsed time over 5 s: the `lunchbags` example took 6.5 s on Debian. It now solves one portfolio size. The `turf()` example now uses a smaller simulated data set. Every example runs in under 2 s on a laptop (the slowest, `chips`, takes about 1.7 s); the win-builder Debian check reports no example over 5 s.
- Possibly misspelled words in DESCRIPTION: Ennis, Fayle, and ReVelle are author names in the references, and "unduplicated" is part of the name of the method (total unduplicated reach and frequency).

## Submission

This is a new package, not yet on CRAN.

## Test environments

- macOS 26 (arm64), R 4.6.1, local
- GitHub Actions: macOS (release), Windows (release), Ubuntu (devel, release, oldrel-1)
- GitHub Actions: Ubuntu 24.04 (release), `R CMD check --as-cran` with the PDF manual
- win-builder: R-devel (2026-09-25 r90590 ucrt), `R CMD check --as-cran`

## R CMD check results

- win-builder, R-devel (Windows and Debian): 0 errors | 0 warnings | 1 note.
  The note is CRAN incoming feasibility: "New submission" and the possibly misspelled words
  explained above (Ennis, Fayle, ReVelle, unduplicated).
- GitHub Actions, Ubuntu 24.04 (release), `--as-cran` with the PDF manual: 0 errors | 0 warnings |
  1 note. The note is about the HTML manual: the runner has no HTML Tidy and no V8, so R skips
  HTML validation and math rendering. The PDF manual builds without problems.
- GitHub Actions, macOS, Windows and Ubuntu matrix: 0 errors | 0 warnings | 0 notes.

## Data

The package includes four example data sets from public sources: `ham`, `pies`, and `lunchbags` under CC BY 4.0, and `coffee` under CC0 1.0. The `Copyright` field in DESCRIPTION points to `inst/COPYRIGHTS`, which gives the source, license, and changes for each. The help page of each data set gives the same attribution.
