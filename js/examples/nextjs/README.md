# Next.js example

A Next.js route handler that solves a TURF problem with `turflp`: `app/api/turf/route.ts`.

## Run locally

Use Node.js 22. From the repository root, build and install the solver from this checkout:

```sh
cd js
npm ci
npm pack
cd examples/nextjs
npm install --save-exact ../../turflp-0.5.0.tgz
npm run build
npm start
```

The archive name follows `js/package.json`; change it if testing a different version. Installing the local tarball is required: this example's initial `package.json` does not include `turflp`. For a separate application, copy the tarball into that application's checkout and commit its lockfile as described in the [JavaScript installation guide](../../README.md#installation).

From another terminal, send a request to the running server:

```sh
curl -X POST localhost:3000/api/turf -H 'content-type: application/json' \
  -d '{"reach": [[0,1,0,0,1],[0,0,1,1,1],[0,0,1,1,0],[0,1,0,0,1],[0,0,1,0,1],[1,0,0,1,0],[1,1,0,0,0],[0,1,1,0,1]], "size": 2, "fixed": [0]}'
```

The body is `{ reach, size, tiebreak?, names?, fixed? }`. The response is `{ "portfolio": {...}, "ms": <solve time>, "cached": <boolean> }`.

Product indices, including `fixed`, are 0-based. Keep `portfolio.warnings` with the displayed result. This example has no authentication or persistent job storage. Add the service's access checks before using it with private data.

## How a request runs

The solve does not run on the request thread. Each function instance has one solver worker (`workers/solve.mjs`, started by `lib/supervisor.ts`) that runs one solve at a time; up to 4 more requests wait in a queue. On Vercel, two solves in one instance share its CPU, so a second active solve would only make both slower. Each request has a deadline of 50 seconds from its arrival, queue time included (`maxDuration` is 60). When the deadline passes, the supervisor terminates the worker, answers 504, and starts a new worker for the next request. A request that the client aborts leaves the queue; a solve that has started runs to its end.

Set `TURFLP_JOB_DEADLINE_MS` to change the deadline in milliseconds (default `50000`). Keep the platform's request duration above it. The worker sets V8's old-generation heap limit to 512 MB. This is not a limit on total process or WebAssembly memory. If the worker exits, the route returns 500.

Complete results (no warnings) are kept in a cache of at most 16 MB per instance for 10 minutes, keyed on the matrix, size, fixed set, tie-break order, names, and turflp version. A service with several tenants must add the tenant to the key and check access before the lookup.

| Status | When |
|---|---|
| 400 | The body is not JSON, `reach` is not an array of rows, or the package rejects an input (for example a cell that is not 0 or 1, or a fixed index out of range); the package's message is returned. |
| 413 | The body is over 512 KB, the matrix has more than 8000 cells, or `size` is over 8. Such problems belong in a background job. |
| 503 | One solve is running and 4 are waiting. The response has `Retry-After: 1`. |
| 504 | The request passed its configured deadline (50 seconds by default). |
| 500 | The solver failed (an invalid HiGHS solution, or the worker ended). |
| 499 | The client aborted the request while it waited; no client reads this answer. |

The limits are per instance. A limit for the whole service needs the platform's rate limits or a shared store.

On Vercel with Fluid compute, several concurrent requests can go to one instance, because its handler only waits for the worker. They then wait in that instance's queue, so each waiting request adds one solve time, and past the queue the answer is 503. In a test on Vercel (gen-bench-200x20, size 5, about 1.65 s per solve; turfLP 0.4.0), the median request took 1.7 s at 1 concurrent request, 3.3 s at 2, 6.5 s at 4, and at 8 the admitted requests took up to 8.3 s (p95) while 31 to 45 of 100 got 503. A route that solves on the request thread scaled out to one instance per request instead (1.7 s at every concurrency), but it cannot stop a solve at a deadline. Plan the queue and the size limit together: a measured 200 x 40 problem can take about 3 s on Vercel, so a request behind 4 such problems waits about 15 s. The limit is 8000 cells, not a separate cap on rows or columns; other shapes and inputs can take longer.

`next.config.mjs` sets `serverExternalPackages: ["turflp", "highs"]`, `output: "standalone"`, and `outputFileTracingIncludes` for the worker script and the two packages, which the route loads by path. See the "Next.js on Vercel" section of `../../README.md`.

## Tests

`node --experimental-strip-types scripts/supervisor-test.mjs` checks the queue limit, the deadline (an active job and a queued one), a worker that exits, the error classes, aborted requests, and the cache keys and byte bound, with a stand-in worker.

`node scripts/standalone-test.mjs` (use Node.js 22) packs `turflp` from `../..`, builds a copy of this example against the tarball, copies the traced `.next/standalone` output to a temporary folder outside the checkout, deletes the build, starts the server there, and checks a fixed 200 x 20 benchmark request (conformance input `gen-bench-200x20`, size 5) against the exact expected values, once solved and once from the cache. It then checks `fixed`, the 400 and 413 answers, a burst of 6 requests (five answers and one 503), and, on a second server with a 250 ms deadline, a 504 and the next request's answer. CI runs both on every push.
