# Developing and releasing turfLP

Run the commands below from the repository root unless a section says otherwise. The R package is at the root; Python, JavaScript, the dashboard, and the Next.js example have separate dependencies.

## Repository map

| Path | Responsibility |
|---|---|
| `R/`, `man/`, `data/`, `tests/` | R implementation, generated help, examples, and tests |
| `python/src/turflp/`, `python/tests/` | Python package and tests |
| `js/src/`, `js/test/` | JavaScript package and tests |
| `js/examples/nextjs/` | Bounded HTTP example with a solver worker |
| `dashboard/` | Standalone browser application; not a package API |
| `docs/algorithm.md` | Shared algorithm and public behavior specification |
| `conformance/` | Shared fixtures with independently enumerated optima |
| `data-raw/`, `research/` | Data preparation and reference provenance |
| `.github/workflows/` | Test and publication commands used by CI |

Applications consume the packages through their public APIs. Keep application-specific CSV handling, charts, access control, persistence, and job orchestration outside the solver packages. Internal JavaScript modules such as `core.ts` and `prepare.ts` are not public package exports.

## R

Install R and the development dependencies:

```sh
Rscript -e 'install.packages(c("remotes", "pkgload", "testthat", "roxygen2", "rcmdcheck", "jsonlite"), repos = "https://cloud.r-project.org")'
Rscript -e 'remotes::install_deps(dependencies = TRUE)'
```

Run the R tests and shared fixtures against the checkout:

```sh
Rscript -e 'pkgload::load_all("."); testthat::test_local(".")'
Rscript conformance/run_r.R
Rscript -e 'rcmdcheck::rcmdcheck(args = "--no-manual", error_on = "warning")'
```

Edit function help in the roxygen comments in `R/`. Generate `man/` and `NAMESPACE` with `Rscript -e 'roxygen2::roxygenise()'`; do not edit generated help directly. A full `--as-cran` check with the PDF manual also needs a working LaTeX installation. CI runs that check.

## Python

Install [uv](https://docs.astral.sh/uv/) and run:

```sh
cd python
uv sync --locked --extra test --python 3.13
uv run --locked pytest -q
uv build
```

The test suite includes the shared conformance fixtures. CI also tests Python 3.10, the minimum supported `highspy`, and installation of the built wheel in a clean environment. Commit `uv.lock` when changing Python dependencies.

## JavaScript

Use Node.js 22 for the complete development workflow. The core package supports Node.js 20 or later; individual build and test tools can require a newer minor version.

```sh
cd js
npm ci
npm run typecheck
npm run build
npm test
npm run test:conformance
npm pack
```

`npm pack` runs the build through `prepack`. Commit `package-lock.json` when changing dependencies. `npm run test:conformance` imports the built package, so build before running it. See the [Next.js example](../js/examples/nextjs/README.md) for its setup and tests.

## Dashboard

Install the JavaScript package's dependencies first. From the repository root:

```sh
npm ci --prefix js
npm ci --prefix dashboard
npm run typecheck --prefix dashboard
npm test --prefix dashboard
npm run build --prefix dashboard
npm run test:browser --prefix dashboard
```

The browser test needs Chrome; set `CHROME_PATH` if it is not in a standard location. It opens the built HTML as a local file, with and without Web Workers. A normal build does not need Chrome. Generated output goes into `dashboard/dist/`; do not commit it.

## Change a shared behavior

1. Add or correct the rule in [algorithm.md](algorithm.md).
2. Update all affected language implementations and their user documentation.
3. Add a small regression case at the boundary where the failure occurs. For a shared numerical rule, extend the conformance inputs or generator rather than copying expected values from a solver.
4. Run the affected language tests and shared fixtures. Keep the independent expected values intact.
5. Record user-visible changes under the development heading in [NEWS.md](../NEWS.md).

Check fixture generation from the repository root:

```sh
python3 conformance/generate.py --check
python3 conformance/test_generate.py
```

These commands need only Python's standard library. Regeneration rules and the pass criteria are in the [conformance guide](../conformance/README.md). Dataset changes can also require updating the packaged Python CSV files and running `npm run gen:datasets --prefix js`.

## Versions and releases

The source version is recorded in `DESCRIPTION`, `python/pyproject.toml`, `python/src/turflp/__init__.py`, `js/package.json`, and `dashboard/package.json`. Keep lockfile version metadata consistent when changing these versions. [NEWS.md](../NEWS.md) separates unreleased work from tagged versions. A documentation correction alone does not require a package version bump.

Before a release:

1. Confirm that the version and release notes match the intended source commit. Check all four test workflows: R, Python, JavaScript (including the dashboard and Next.js example), and conformance.
2. Build and test the Python wheel and JavaScript tarball. Check that their README, license notices, data, and public imports are present.
3. Build the standalone dashboard from the same source. Keep its release artifact distinct from later work on `main`.
4. Obtain release approval, then tag the reviewed commit as `v<version>` and publish its GitHub release. The npm and PyPI workflows run on the release's `published` event. They use the configured `npm` and `pypi` GitHub environments and registry trusted publishers. A GitHub release alone does not prove either publication succeeded.
5. Check both publication jobs and query the registries for the exact version. Install that version in clean environments and run a small example before announcing availability.

Registry checks for 0.4.0:

```sh
npm view turflp@0.4.0 version
python3 -m pip index versions turfLP
```

On 2026-10-23, GitHub and PyPI had 0.4.0, but npm had only 0.2.0. Use the [JavaScript tagged-source instructions](../js/README.md#installation) for 0.4.0 until npm publication is verified. Do not replace a requested version silently with `latest`.

For a consuming app, pin an exact package version and commit its lockfile. A local JavaScript tarball must be kept inside the app's checkout if its lockfile refers to that file. For R, pin a release tag or commit and use an environment lockfile when repeatable dependency versions matter. Keep corrective solver releases possible; pinning an application does not freeze development of the library.

## Report a problem

Include the language, turfLP version, HiGHS version, platform, a small non-sensitive input matrix, the exact options, warnings or error text, and the expected result. For a numerical discrepancy, include the returned portfolio and the criterion that differs. Two different product sets with equal requested criteria can both be correct.
