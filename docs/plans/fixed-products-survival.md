# Survival guide: fixed products (read first after any restart)

## Mission

Implement docs/plans/fixed-products.md. The plan is the source of truth.

## Run Control

- Run mode: finite.
- Driver: turf-opus (Claude Opus 5.5) in Herdr workspace wCJ. Work driver: host-native.
- Reviewers (Herdr agents, read-only): turf-astra (Codex), turf-grok (Grok), turf-agy (Gemini, always `/boost`).
- Branch: feat/fixed-products. Base: main at 06afb81. Checkout: /Users/john/aigora/dev/turfLP.
- Merge authority: John authorized merge in this session (2026-10-21), after all reviews are green. Regular merge commit only.
- Release authority: John asked for the version bump on GitHub: tag and release v0.3.0. A published release starts publish-npm.yaml and publish-python.yaml.
- Review loop (John, 2026-10-21): planning docs reviewed until green, then the run, then reviews of the work until green.
- No AI attribution in commits or PRs.

## Stop Gate

Stop allowed right now: no. Stop only after the release, or on a hard blocker.

## Current phase

B4 review; B5 in progress.

## Next exact action

Send B1 to the reviewers.

## Deferred hygiene

None.

## Out-of-scope findings

None.

## Gates

- `python3 conformance/generate.py --check`; `python3 conformance/test_generate.py`
- `Rscript conformance/run_r.R`; `R CMD build . && R CMD check --as-cran turfLP_*.tar.gz`
- Python: `cd python && uv sync --locked --extra test && uv run --locked pytest`
- JS: `cd js && npm ci && npm run typecheck && npm test && npm run build && npm run test:conformance`
- Dashboard (needs `npm ci` in js/ first): `cd dashboard && npm ci && npm run typecheck && npm test && npm run build && npm run test:browser`
