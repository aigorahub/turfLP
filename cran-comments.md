## Resubmission

This is a resubmission. The incoming pretests of the first submission gave two NOTEs:

- Examples with elapsed time over 5 s: the `lunchbags` example took 6.5 s on Debian. It now solves one portfolio size. The `turf()` example now uses a smaller simulated data set. Every example runs in less than 1.5 s on a laptop.
- Possibly misspelled words in DESCRIPTION: Ennis, Fayle, and ReVelle are author names in the references, and "unduplicated" is part of the name of the method (total unduplicated reach and frequency).

## Submission

This is the first submission of turfLP.

## Test environments

- macOS 26 (arm64), R 4.6.1, local
- GitHub Actions: macOS (release), Windows (release), Ubuntu (devel, release, oldrel-1)
- GitHub Actions: Ubuntu 24.04 (release), `R CMD check --as-cran` with the PDF manual
- win-builder: R-devel (2026-09-25 r90590 ucrt), `R CMD check --as-cran`

## R CMD check results

0 errors | 0 warnings | 1 note

- New submission.

## Data

The package includes four example data sets from public sources: `ham`, `pies`, and `lunchbags` under CC BY 4.0, and `coffee` under CC0 1.0. The `Copyright` field in DESCRIPTION points to `inst/COPYRIGHTS`, which gives the source, license, and changes for each. The help page of each data set gives the same attribution.
