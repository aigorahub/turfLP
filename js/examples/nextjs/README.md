# Next.js example

A Next.js route handler that solves a TURF problem with `turflp`: `app/api/turf/route.ts`.

```sh
curl -X POST localhost:3000/api/turf -H 'content-type: application/json' \
  -d '{"reach": [[0,1,0,0,1],[0,0,1,1,1],[0,0,1,1,0],[0,1,0,0,1],[0,0,1,0,1],[1,0,0,1,0],[1,1,0,0,0],[0,1,1,0,1]], "size": 2}'
```

The response is `{ "portfolio": {...}, "ms": <solve time> }`. The route answers 413 for problems above its size limit; those belong in a background job.

`next.config.mjs` sets `serverExternalPackages: ["turflp", "highs"]` and `output: "standalone"`. See the "Next.js on Vercel" section of `../../README.md`.

## Standalone test

`node scripts/standalone-test.mjs` (Node.js 20.9 or later) packs `turflp` from `../..`, builds a copy of this example against the tarball, copies the traced `.next/standalone` output to a temporary folder outside the checkout, deletes the build, starts the server there, and checks a fixed 200 x 20 benchmark request (conformance input `gen-bench-200x20`, size 5) against the exact expected values, once cold and once warm. CI runs it on every push.
