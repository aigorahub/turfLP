# turflp for JavaScript and TypeScript

TURF analysis (total unduplicated reach and frequency) with integer linear programming. This is the JavaScript port of the [turfLP R package](https://github.com/aigorahub/turfLP). It uses the same algorithm, solver settings, limits, and warning texts, and it passes the same conformance suite (`conformance/` in the repository), whose expected values come from exact enumeration of every portfolio.

The solver is [HiGHS](https://highs.dev) compiled to WebAssembly (the npm package `highs`). The package is ESM with TypeScript types and runs on Node.js 20 or later.

## Installation

The package is not on npm yet. Build a tarball from the repository and install it:

```sh
git clone https://github.com/aigorahub/turfLP.git
cd turfLP/js && npm ci && npm pack          # writes turflp-0.2.0.tgz
cd /path/to/your/app && npm install /path/to/turfLP/js/turflp-0.2.0.tgz
```

## Usage

The input is an array of rows, one per respondent, with one 0/1 (or boolean) value per product.

```ts
import { turf, turfSizes } from "turflp";
import { load } from "turflp/datasets";

const ham = load("ham");                                   // 127 consumers, 9-point liking of 8 hams
const reach = ham.values.map((row) => row.map((v) => v >= 7));   // top-3 box
console.log(await turf(reach, 2, { names: ham.columns }));
// {
//   products: [ 3, 4 ], names: [ 'N4', 'S1' ], size: 2, reach: 98,
//   reachProp: 0.7716535433070866, frequency: 118, penetration: 58.98305084745762,
//   respondents: 127, warnings: []
// }

for (const p of await turfSizes(reach, [1, 2, 3, 4], { names: ham.columns })) {
  console.log(p.size, p.reach, p.names.join(", "));
}
// 1 60 S1
// 2 98 N4, S1
// 3 111 N2, N3, S1
// 4 119 N1, N3, N4, S1
```

## Functions

```ts
turf(reach, size, options?): Promise<Portfolio>
turfMinCover(reach, options?: { names? }): Promise<Portfolio>
turfSizes(reach, sizes?, options?): Promise<Portfolio[]>
loadSolver(options?: { locateFile?, wasmBinary?, wasmModule? }): Promise<void>

interface TurfOptions {
  tiebreak?: ("frequency" | "penetration")[];   // default ["frequency", "penetration"]
  names?: string[];                             // default P1, P2, ...
  maxPool?: number;                             // default 1000
  maxPoolSeconds?: number;                      // default 30
}

interface Portfolio {
  products: number[]; names: string[]; size: number; reach: number; reachProp: number;
  frequency: number; penetration: number; respondents: number; warnings: string[];
}
```

- `turf` finds the `size` products that reach the most respondents. Ties on reach are broken by `tiebreak`, in order: `"frequency"` (the sum of the individual reaches) and `"penetration"` (the harmonic mean of the individual reaches). An empty `tiebreak` means reach only.
- `turfMinCover` finds the fewest products that together reach every respondent that some product reaches.
- `turfSizes` solves several sizes. The default is every size from 1 to the minimum cover size.
- `loadSolver` is optional. The first call of any function loads the WebAssembly solver, and later calls reuse it. Pass `locateFile` when a bundler moves `highs.wasm`. Pass `wasmBinary` (the bytes of `highs.wasm`) or `wasmModule` (a compiled `WebAssembly.Module`) to load the solver without reading or fetching the file, for example in a browser worker ([dashboard/](../dashboard/) does this).
- Errors are thrown as `TypeError` (wrong types) or `RangeError` (bad values) with the texts of the R package. `maxPool` must be a whole number of 0 or more and `maxPoolSeconds` a number of 0 or more (`Infinity` for no limit); they are checked before any solve.

## The solve blocks the thread

Loading the solver is asynchronous, but HiGHS solves synchronously: while a solve runs, it blocks the JavaScript thread, and the returned promise cannot cancel it. Keep request-time problems small, and move large ones to a background job or a worker thread.

Times for one `turf()` call with both tie-breaks (`node scripts/benchmark.mjs`, Apple M5 Pro, Node.js 26, measured while the machine was busy with other work):

| Input | Size | Time |
|---|---:|---:|
| Loading the solver (first call) | | 13 ms |
| 200 respondents x 20 products | 5 | 0.45 s |
| 200 respondents x 40 products | 8 | 0.08 s |
| 16 x 402, 201 portfolios tied on penetration | 2 | 9.4 s |

Run time depends on the data as well as its size: many portfolios that tie on penetration make the penetration search slow, up to its 30-second budget.

## Next.js on Vercel

`examples/nextjs/` has a working route handler. The points that matter:

- Use the Node.js runtime (`export const runtime = "nodejs"`). The Edge runtime cannot load the solver.
- Add `serverExternalPackages: ["turflp", "highs"]` to `next.config`, so that `highs` finds `highs.wasm` next to its own module.
- Start `loadSolver()` at module level and await it in the handler, so that each function instance loads the solver once.
- Set `maxDuration` with headroom (the example uses 60 seconds), as an operational ceiling, not a guarantee. The penetration pool and a later frequency search each have a 30-second budget, the reach stage and the first penetration solve have none, and a running solve cannot be interrupted. A request only stays within the ceiling because the size rule below keeps it small.
- Solve in the request only below a size limit that fits your latency budget (the example accepts up to 200 x 40 cells and size 8, which took well under a second in the tests above). Decide before the solve: send larger problems, and any problem whose time you cannot predict (for example data with many near-identical products), to a background job (for example an Inngest function) that calls the same `turf()`.

The example's `scripts/standalone-test.mjs` builds it against the packed package with `output: "standalone"`, copies the traced output outside the checkout, starts it, and checks a fixed benchmark request against the exact expected values. That checks the file tracing that Vercel uses; it is not a Vercel deployment.

## Limits and warnings

The penetration tie-break is decided in JavaScript, not by the solver: the package collects every portfolio whose penetration can equal the optimum and compares them with the rule in `docs/algorithm.md` section 5. After the first penetration solve, that search examines up to `maxPool` more portfolios (1000 by default) within `maxPoolSeconds` seconds (30 by default). If it stops early and frequency comes next, the frequency stage gets another `maxPoolSeconds`. When a search stops early, the result's `warnings` array says which value is not proved optimal. The package never logs to the console.

## Differences from R

- Product indices are 0-based (`products: [3, 4]` above is `c(4, 5)` in R).
- The functions are asynchronous and return plain objects; `reachProp` is camelCase.
- Warnings are returned in `warnings`, with the same texts as the R warnings.
- The limits are options instead of the R options `turfLP.max_pool` and `turfLP.max_pool_seconds`.
- HiGHS presolve is on. The R package turns it off because HiGHS 1.14, which the R `highs` package bundles, returned a wrong optimum with presolve on in a test case. HiGHS 1.15 solves that case correctly.
- There is no `turf_simulate()`.

When several portfolios are optimal, R, Python, and JavaScript can return different ones, with the same values of the requested criteria. When a search stops early, the warning says which value is not proved optimal.

## Data sets

`load(name)` from `turflp/datasets` returns `{ columns, values }` with the raw responses of one of the seven example data sets of the R package: `cafe`, `chips`, `coffee`, `ham`, `icecream`, `lunchbags`, and `pies`. The data sets are a separate entry point, so the main bundle does not include them. `ham`, `pies`, and `lunchbags` are under CC BY 4.0 and `coffee` under CC0 1.0; see `COPYRIGHTS`.

## License

MIT. See `LICENSE`. The data licenses are in `COPYRIGHTS`.
