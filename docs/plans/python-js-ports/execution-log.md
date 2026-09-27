# Execution log: turfLP Python and JavaScript ports

## 2026-09-26 21:53 EDT staging

- Created worktree `/Users/john/aigora/dev/turfLP-python-js-ports` on `feat/python-js-ports` from `origin/main` at `ebea497080b292cc31e50d7450b92f06b6855ba2`.
- Wrote the plan, survival guide, learnings, and this log.
- Checked toolchains: Python 3.14.7, Node.js 26.3.0, npm 11.16.0, uv available; highspy 1.15.1 and highs-js 1.15.3 solve the 7 by 4 presolve matrix correctly with presolve on; highs-js solves 200 x 20 (k = 5) in about 0.35 s and 500 x 40 (k = 8) in about 2.6 s per reach solve.

## 2026-09-26 22:10 EDT plan review and revision

- Opened draft PR #2 at the staging commit `b153c51`.
- Plan reviews: `/private/tmp/claude-501/-Users-john-aigora-dev-turfLP/ea7aeaf6-8fd0-4818-85ee-d90f3bf01469/scratchpad/reviews/plan-turflp-astra.md` (3 blocking, 5 advisory), `plan-turflp-agy.md` (7 blocking, 4 advisory), `plan-turflp-fugu.md` (7 blocking, 3 advisory), `plan-turflp-grok.md` (2 blocking, 5 advisory).
- Shared blocking findings and resolutions: HiGHS defaults differ from R (gaps 1e-4 and 1e-6, feasibility 1e-7 and 1e-6), so the plan now sets explicit settings with presolve as the one named difference and a presolve-on/off differential run; the pass rule now compares only reach and the requested criteria, has separate minimum-cover, sizes, and bounded classes; inputs are frozen from R with digests; the public API is specified in `docs/algorithm.md` section 15; the JavaScript solve is documented as synchronous; the Next.js proof is a traced standalone build run outside the checkout; the npm package gets LICENSE and COPYRIGHTS; `.Rbuildignore` and `.gitignore` cover the new folders from B1.
- Added acceptance ids B1-A6, B2-A6, B3-A6 and reworded existing criteria (no evidence existed yet).
- Deviation noted: an actual Vercel deployment stays a manual user check (needs the user's Vercel project); browser support is out of scope.
