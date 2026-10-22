# Next.js example

A Next.js route handler that solves a TURF problem with `turflp`: `app/api/turf/route.ts`.

```sh
curl -X POST localhost:3000/api/turf -H 'content-type: application/json' \
  -d '{"reach": [[0,1,0,0,1],[0,0,1,1,1],[0,0,1,1,0],[0,1,0,0,1],[0,0,1,0,1],[1,0,0,1,0],[1,1,0,0,0],[0,1,1,0,1]], "size": 2, "fixed": [0]}'
```

The body is `{ reach, size, tiebreak?, names?, fixed? }`. The response is `{ "portfolio": {...}, "ms": <solve time>, "cached": <boolean> }`.

## How a request runs

The solve does not run on the request thread. Each function instance has one solver worker (`workers/solve.mjs`, started by `lib/supervisor.ts`) that runs one solve at a time; up to 4 more requests wait in a queue. On Vercel, two solves in one instance share its CPU, so a second active solve would only make both slower. Each request has a deadline of 50 seconds from its arrival, queue time included (`maxDuration` is 60). When the deadline passes, the supervisor terminates the worker, answers 504, and starts a new worker for the next request. A request that the client aborts leaves the queue; a solve that has started runs to its end.

Complete results (no warnings) are kept in a cache of at most 16 MB per instance for 10 minutes, keyed on the matrix, size, fixed set, tie-break order, names, and turflp version. A service with several tenants must add the tenant to the key and check access before the lookup.

| Status | When |
|---|---|
| 400 | The body is not JSON, `reach` is not an array of rows, or the package rejects an input (for example a cell that is not 0 or 1, or a fixed index out of range); the package's message is returned. |
| 413 | The body is over 512 KB, the matrix has more than 8000 cells, or `size` is over 8. Such problems belong in a background job. |
| 503 | One solve is running and 4 are waiting. The response has `Retry-After: 1`. |
| 504 | The request passed its 50-second deadline. |
| 500 | The solver failed (an invalid HiGHS solution, or the worker ended). |

The limits are per instance. A limit for the whole service needs the platform's rate limits or a shared store.

`next.config.mjs` sets `serverExternalPackages: ["turflp", "highs"]`, `output: "standalone"`, and `outputFileTracingIncludes` for the worker script and the two packages, which the route loads by path. See the "Next.js on Vercel" section of `../../README.md`.

## Tests

`node --experimental-strip-types scripts/supervisor-test.mjs` checks the queue limit, the deadline (an active job and a queued one), a worker that exits, the error classes, aborted requests, and the cache keys and byte bound, with a stand-in worker.

`node scripts/standalone-test.mjs` (Node.js 20.9 or later) packs `turflp` from `../..`, builds a copy of this example against the tarball, copies the traced `.next/standalone` output to a temporary folder outside the checkout, deletes the build, starts the server there, and checks a fixed 200 x 20 benchmark request (conformance input `gen-bench-200x20`, size 5) against the exact expected values, once solved and once from the cache. It then checks `fixed`, the 400 and 413 answers, a burst of 6 requests (five answers and one 503), and, on a second server with a 250 ms deadline, a 504 and the next request's answer. CI runs both on every push.
