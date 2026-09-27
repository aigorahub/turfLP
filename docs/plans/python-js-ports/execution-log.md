# Execution log: turfLP Python and JavaScript ports

## 2026-09-26 21:53 EDT staging

- Created worktree `/Users/john/aigora/dev/turfLP-python-js-ports` on `feat/python-js-ports` from `origin/main` at `ebea497080b292cc31e50d7450b92f06b6855ba2`.
- Wrote the plan, survival guide, learnings, and this log.
- Checked toolchains: Python 3.14.7, Node.js 26.3.0, npm 11.16.0, uv available; highspy 1.15.1 and highs-js 1.15.3 solve the 7 by 4 presolve matrix correctly with presolve on; highs-js solves 200 x 20 (k = 5) in about 0.35 s and 500 x 40 (k = 8) in about 2.6 s per reach solve.
