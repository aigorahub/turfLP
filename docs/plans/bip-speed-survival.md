# Survival guide: BIP speed (read first after any restart)

## Mission

Implement docs/plans/bip-speed.md. The plan is the source of truth.

## Run Control

See docs/plans/bip-speed.md, Run Control. Checkout /Users/john/aigora/dev/turfLP, branch feat/bip-speed, base 797a2a2.

## Stop Gate

Stop allowed right now: no. Stop only after the release and the redeploy, or on a hard blocker.

## Current phase

B1 delta, B2, B3, B5 reviews (astra, grok) sent at c414373. Baseline and B3 benchmarks running in worktrees. B4 MIP start code is uncommitted in js/src (settings.mipStart, default off) until measured.

## Next exact action

When the baseline and B3 benchmarks finish: log them, run the interleaved primary gate (baseline 34536fc against B3 0dd093d, skip and mipStart variants), decide skip and mipStart, commit B4. Then B6.

## Deferred hygiene

- Dashboard: the column tooltip of the grouped fixed segment lists names without "Fixed:" (agy advisory on PR #20).

## Out-of-scope findings

- Issue #21: reach and frequency frontier as a package function.

## Gates

- `python3 conformance/generate.py --check`; `python3 conformance/test_generate.py`
- `Rscript -e 'testthat::test_local()'`; `Rscript conformance/run_r.R`; R CMD check --as-cran with TinyTeX on PATH (~/Library/TinyTeX/bin/universal-darwin)
- Python: `cd python && uv sync --locked --extra test && uv run --locked pytest`
- JS: `cd js && npm ci && npm run typecheck && npm test && npm run build && npm run test:conformance`
- Dashboard (after js build): `cd dashboard && npm ci && npm run typecheck && npm test && npm run build && npm run test:browser`
- Next.js (after js build): `cd js/examples/nextjs && node scripts/standalone-test.mjs`
- If an npm audit request stalls, use --no-audit and record it.
