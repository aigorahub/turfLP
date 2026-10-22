# Survival guide: BIP speed (read first after any restart)

## Mission

Implement docs/plans/bip-speed.md. The plan is the source of truth.

## Run Control

See docs/plans/bip-speed.md, Run Control. Checkout /Users/john/aigora/dev/turfLP, branch feat/bip-speed, base 797a2a2.

## Stop Gate

Stop allowed right now: no. Stop only after the release and the redeploy, or on a hard blocker.

## Current phase

B1-B8 done. B3 delta, B5 delta, B4 full sent to astra and grok at 0a47ccc. Then the final review by all three (agy with /boost) at the final head.

## Next exact action

Read the astra and grok verdicts; fix blockers; send the final head to astra, grok, and agy. Then remove the run files, run all gates, mark the PR ready, CI green, merge with a merge commit, release v0.4.0 with turflp-dashboard.html, check PyPI, redeploy turf.aigora.ai.

## Deferred hygiene

- (done) Dashboard: the column tooltip of the grouped fixed segment now says "Fixed:".

## Out-of-scope findings

- Issue #21: reach and frequency frontier as a package function.

## Gates

- `python3 conformance/generate.py --check`; `python3 conformance/test_generate.py`
- `Rscript -e 'testthat::test_local()'`; `Rscript conformance/run_r.R`; R CMD check --as-cran with TinyTeX on PATH (~/Library/TinyTeX/bin/universal-darwin)
- Python: `cd python && uv sync --locked --extra test && uv run --locked pytest`
- JS: `cd js && npm ci && npm run typecheck && npm test && npm run build && npm run test:conformance`
- Dashboard (after js build): `cd dashboard && npm ci && npm run typecheck && npm test && npm run build && npm run test:browser`
- Next.js (after js build): `cd js/examples/nextjs && node --experimental-strip-types scripts/supervisor-test.mjs && node scripts/standalone-test.mjs`
- If an npm audit request stalls, use --no-audit and record it.
