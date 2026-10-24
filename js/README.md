# turflp for JavaScript and TypeScript

TURF analysis (total unduplicated reach and frequency) with integer linear programming. This is the JavaScript port of the [turfLP R package](https://github.com/aigorahub/turfLP). It follows the same algorithm specification, limits, and warning texts, with the solver differences listed below. It passes the same conformance suite (`conformance/` in the repository), whose expected optima come from exact enumeration of every portfolio.

The solver is [HiGHS](https://highs.dev) compiled to WebAssembly (the npm package `highs`). The package is ESM with TypeScript types. It runs on Node.js 20 or later and in browsers; see "In the browser" and "Browser or server" below.

## Installation

This checkout is JavaScript **0.5.0**, which adds `turfBaselines` and `turfFrontier`. The installation below uses the existing 0.4.0 tag and provides the core APIs only. On 2026-10-23, npm had only 0.2.0. That version does not include `fixed`, which was added in 0.3.0. Check availability before using a registry version:

```sh
npm view turflp versions --json
```

To install 0.4.0 now, build the tagged source with Node.js 22:

```sh
git clone --branch v0.4.0 --depth 1 https://github.com/aigorahub/turfLP.git
cd turfLP/js && npm ci && npm pack          # writes turflp-0.4.0.tgz
```

Copy that tarball into the consuming app. Replace the paths below with your app and checkout paths:

```sh
cd /path/to/your/app
mkdir -p vendor
cp /path/to/turfLP/js/turflp-0.4.0.tgz vendor/
npm install --save-exact ./vendor/turflp-0.4.0.tgz
```

Commit `vendor/turflp-0.4.0.tgz`, `package.json`, and `package-lock.json` together so another machine can run `npm ci`. Do not point the dependency at a tarball outside the app checkout. Once `npm view turflp@0.4.0 version` confirms registry publication, `npm install --save-exact turflp@0.4.0` is the registry alternative. An unpinned `npm install turflp` follows npm's latest release, not this repository's version.

For development source, clone without `--branch v0.4.0 --depth 1` and pack from the chosen commit. Record that commit as well as the package version; unreleased code can still carry the last release's version.

## Usage

The input is a rectangular array of rows, one per respondent, with one 0/1 (or boolean) value per product. Empty matrices, missing cells, and other values are rejected. Convert ratings to booleans before calling the solver. Rows with no reached products still count in the denominator. The [usage guide](https://github.com/aigorahub/turfLP/blob/main/docs/usage.md) explains each result field and the choice of sizes.

```ts
import { turf, turfSizes } from "turflp";
import { load } from "turflp/datasets";

const ham = load("ham");                                   // 127 consumers, 9-point liking of 8 hams
const reach = ham.values.map((row) => row.map((v) => v >= 7));   // top-3 box
console.log(await turf(reach, 2, { names: ham.columns }));
// {
//   products: [ 3, 4 ], names: [ 'N4', 'S1' ], size: 2, reach: 98,
//   reachProp: 0.7716535433070866, frequency: 118, penetration: 58.98305084745762,
//   respondents: 127, fixed: [], warnings: []
// }

// Product N1 (column 0) must be in the portfolio; the stages choose the other two.
const p = await turf(reach, 3, { names: ham.columns, fixed: [0] });
console.log(p.names, p.reach);   // [ 'N1', 'N4', 'S1' ] 110

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
turfMinCover(reach, options?: { names?, fixed? }): Promise<Portfolio>
turfSizes(reach, sizes?, options?): Promise<Portfolio[]>
loadSolver(options?: { locateFile?, wasmBinary?, wasmModule? }): Promise<void>

interface TurfOptions {
  tiebreak?: readonly ("frequency" | "penetration")[]; // default ["frequency", "penetration"]
  names?: readonly string[];                     // default P1, P2, ...
  fixed?: readonly number[] | null;              // 0-based columns every portfolio contains; default []
  maxPool?: number;                             // default 1000
  maxPoolSeconds?: number;                      // default 30
}

interface Portfolio {
  readonly products: readonly number[]; readonly names: readonly string[];
  readonly size: number; readonly reach: number; readonly reachProp: number;
  readonly frequency: number; readonly penetration: number; readonly respondents: number;
  readonly fixed: readonly number[]; readonly warnings: readonly string[];
}
```

- `turf` finds the `size` products that reach the most respondents. Ties on reach are broken by `tiebreak`, in order: `"frequency"` (the sum of the individual reaches) and `"penetration"` (the harmonic mean of the individual reaches). An empty `tiebreak` means reach only.
- `fixed` lists the 0-based column indices of products that every portfolio must contain, for example products already on the shelf. `size` counts them, and the stages choose the other products. Each fixed product must reach at least one respondent; duplicates are ignored.
- Returned `products` and `fixed` are sorted by ascending column index. At runtime, `tiebreak: null` also means reach only; use `[]` with the published TypeScript interface.
- `turfMinCover` finds the fewest products that together reach every respondent that some product reaches, with the `fixed` products among them.
- `turfSizes` solves several sizes. The default is every size from 1 (or the number of fixed products) to the minimum cover size with the same `fixed`.
- `loadSolver` is optional. The first solve loads the WebAssembly solver, and later calls reuse it. Pass `locateFile` when a bundler moves `highs.wasm`. Pass `wasmBinary` (an `ArrayBuffer` or `Uint8Array`) or `wasmModule` (a compiled `WebAssembly.Module`) to load the solver without reading or fetching the file. `wasmModule` takes precedence. Concurrent calls share one load, and a failed load can be retried. Supply custom loading options before the first solve; changing them after loading has started throws an error. The browser example below demonstrates byte loading.
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

## In the browser

The same package runs in a browser. The separately maintained [browser application](https://turf.aigora.ai) uses this package. Three things differ from Node.js:

- The browser cannot read `highs.wasm` from `node_modules`. Serve the file (`node_modules/highs/build/highs.wasm`, 3.5 MB, about 1.2 MB with gzip) and pass a function that returns its URL, such as `loadSolver({ locateFile: () => wasmUrl })`, or fetch its bytes and pass them as `wasmBinary`.
- The `highs` loader has branches for Node.js that import `node:module`, `node:fs`, and other built-in modules. They never run in a browser, but the bundler must leave them out. With esbuild, mark `node:*` as external; other bundlers need the same setting.
- The solve blocks the thread, so run it in a Web Worker. To cancel a solve, call `terminate()` on the worker and start a new one.

```ts
// solver-worker.ts, bundled as a worker script
import { loadSolver, turf, type ReachMatrix } from "turflp";

// Serve highs.wasm next to the worker script, or use an absolute URL.
let ready: Promise<void> | undefined;

self.onmessage = async (e: MessageEvent<{ reach: ReachMatrix; size: number }>) => {
  try {
    ready ??= fetch("highs.wasm").then((r) => {
      if (!r.ok) throw new Error(`Cannot load solver: HTTP ${r.status}`);
      return r.arrayBuffer();
    }).then((wasmBinary) => loadSolver({ wasmBinary })).catch((error) => {
      ready = undefined;
      throw error;
    });
    await ready;
    self.postMessage({ portfolio: await turf(e.data.reach, e.data.size) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
```

Handle both reply shapes in the parent and display `portfolio.warnings` with the result. Handle worker startup errors through the worker's `error` event. This example serves one caller; an app with concurrent requests also needs request IDs to match replies.

Chrome does not start a module worker from a page opened as a local file (`file://`), so bundle the worker as a classic script if the page must work that way.

## Browser or server

On the same computer, the browser and Node.js had similar times, because both run the same WebAssembly: on four cases of 1,000 to 5,000 respondents, the dashboard in Chrome took 7 to 15 s, within the run-to-run variation of Node.js on the same inputs. In those four cases, the Node.js time was 1.07 to 1.61 times the time of native HiGHS through the Python package. Move a problem to a server when it takes too long for someone to wait at the page, when the device is slow (a phone), or when the run must continue after the page closes.

Times for one `turf()` call with both tie-breaks, on random data where each product reaches each respondent independently with a probability between 0 and 0.5 (Node.js 26, Apple M5 Pro). Data of this kind is a hard case: real consumer data, where products form groups, solved much faster in these tests.

| Respondents | Products | Size 3 | Size 5 | Size 8 |
|---:|---:|---:|---:|---:|
| 200 | 20 | 0.2 s | 0.1 s | 0.1 s |
| 200 | 40 | 0.5 s | 0.8 s | 0.1 s |
| 200 | 80 | 3.3 s | 2.8 s | 0.1 s |
| 1000 | 20 | 1.7 s | 2.5 s | 0.3 s |
| 1000 | 40 | 5.4 s | 6.3 s | 6.2 s |
| 1000 | 80 | 8.2 s | 31 s | 12 s |
| 5000 | 20 | 15 s | 10 s | 3.0 s |
| 5000 | 40 | 52 s | 56 s | 33 s |
| 5000 | 80 | timeout* | timeout* | timeout* |

*The process exceeded a limit of 150 s that covered loading the solver, the solve, and the enumeration check. No solve time was recorded.

A 20,000 by 20 problem of size 5 took 147 s; 20,000 by 40 at size 5 also exceeded the limit. The example data sets solved faster than random data of the same size: in the dashboard in Chrome, each size from 1 to 8 of `icecream` (120 by 10) took 0.1 s or less, and sizes 1 to 3 of `cafe` (2,500 by 40) took 1.3, 0.5, and 2.3 s. Sizes 1 to 8 of `cafe` took 44 s in total in Node.js.

Data in which many respondents give the same answers solves much faster, because equal respondents share one weighted row of the model (`docs/algorithm.md` section 3): 2,000 respondents with 40 distinct answer patterns and 25 products took 12 ms at size 3, and 42,000 respondents with 9 patterns took 9 ms. Random data like the table above has no such rows, and its times are unchanged.

`turfSizes()` solves each size in turn, so its time is the sum over the sizes. Times of one case varied between runs by up to a factor of about 1.6, and data with many ties on penetration can take up to the 30-second pool budget more.

A rule to start from, to be checked on your own data:

- Browser, in a Web Worker: up to about 1,000 respondents and 20 products, or data like the examples up to a few thousand respondents and 40 products, when a few seconds for each size is acceptable. Show progress for each size and offer Cancel.
- Server, in the request: a measured starting point of 200 respondents and 40 products and size 8. The three measured 200 by 40 cases took less than a second; check your own data before you solve in a request.
- Server, as a background job: problems of 1,000 respondents and 80 products, 5,000 respondents and 40 products, or larger; many sizes at once; and any problem whose run time you cannot predict.

All 18 completed cases with fewer than 3 million portfolios were checked against an enumeration of every portfolio: reach and frequency matched exactly, and penetration matched to within 1e-9 (relative). Cases that timed out have no result and no check.

## Next.js on Vercel

`examples/nextjs/` has a working route handler. The points that matter:

- Use the Node.js runtime (`export const runtime = "nodejs"`). The Edge runtime cannot load the solver.
- Add `serverExternalPackages: ["turflp", "highs"]` to `next.config`, so that `highs` finds `highs.wasm` next to its own module.
- Include the worker script and both packages in `outputFileTracingIncludes`, as the [example configuration](examples/nextjs/next.config.mjs) does. The route starts the worker by path, so the deployment must contain these files.
- Solve in a worker thread, not on the request thread: a running solve cannot be interrupted, but a worker can be terminated. The example keeps one worker per function instance, runs one solve at a time (two solves in one Vercel instance share its CPU), queues at most 4 more, and terminates the worker when a request passes its 50-second deadline. Its README lists the HTTP status of each case.
- On Vercel with Fluid compute, concurrent requests can share one instance and wait in its queue, so latency grows with concurrency (in a test with 1.65-second solves: 1.7 s at 1 request, 6.5 s at 4, and 503 for 31 to 45 of 100 requests at 8). The example's README gives the numbers and the tradeoff against solving on the request thread.
- Set `maxDuration` above that deadline (the example uses 60 seconds). The penetration pool and a later frequency search each have a 30-second budget, and the reach stage and the first penetration solve have none, so only the deadline bounds a request.
- Solve in the request only below a size limit that fits your latency budget (the example accepts at most 8000 cells and size 8, with no separate row or column cap). Decide before the solve: send larger problems, and any problem whose time you cannot predict (for example data with many near-identical products), to a background job (for example an Inngest function) that calls the same `turf()`.

The example's `scripts/standalone-test.mjs` builds it against the packed package with `output: "standalone"`, copies the traced output outside the checkout, starts it, checks a fixed benchmark request against the exact expected values, and checks the HTTP limits and the deadline. That checks the file tracing that Vercel uses; it is not a Vercel deployment.

## Limits and warnings

The penetration tie-break is decided in JavaScript, not by the solver: the package collects every portfolio whose penetration can equal the optimum and compares them with the rule in `docs/algorithm.md` section 5. After the first penetration solve, that search examines up to `maxPool` more portfolios (1000 by default) within `maxPoolSeconds` seconds (30 by default). If it stops early and frequency comes next, the frequency stage gets another `maxPoolSeconds`. These limits do not bound the whole call: the reach stage, a frequency stage before penetration, and the first penetration solve have no time limit. When a search stops early, the result's `warnings` array says which value is not proved optimal. The package never logs to the console.

The validity check also stops after 100 solver attempts per search for a valid solution. This cap prevents repeated rejected candidates from keeping a stage running. A stopped stage reports a warning when it can retain an earlier valid portfolio; without a valid result, it raises an error.

## Differences from R

- Product indices are 0-based (`products: [3, 4]` above is `c(4, 5)` in R).
- The functions are asynchronous and return plain objects; `reachProp` is camelCase.
- Warnings are returned in `warnings`, with the same texts as the R warnings.
- The limits are options instead of the R options `turfLP.max_pool` and `turfLP.max_pool_seconds`.
- HiGHS presolve is on. The R package turns it off because HiGHS 1.14, which the R `highs` package bundles, returned a wrong optimum with presolve on in a test case. HiGHS 1.15 solves that case correctly.
- There is no `turf_simulate()`.
- The solver gets an equivalent smaller model (`docs/algorithm.md` section 3), and a stage whose optimum a portfolio meets at a proved bound is not solved (section 7). The optima are the same as in R.

When several portfolios are optimal, R, Python, and JavaScript can return different ones, with the same values of the requested criteria. When a search stops early, the warning says which value is not proved optimal.

## Data sets

`load(name)` from `turflp/datasets` returns `{ columns, values }` with the raw responses of one of the seven example data sets of the R package: `cafe`, `chips`, `coffee`, `ham`, `icecream`, `lunchbags`, and `pies`. The data sets are a separate entry point, so the main bundle does not include them. `ham`, `pies`, and `lunchbags` are under CC BY 4.0 and `coffee` under CC0 1.0; see `COPYRIGHTS`.

`datasetNames` from `turflp/datasets` lists the available names. Use the [example thresholds](https://github.com/aigorahub/turfLP/blob/main/docs/usage.md#example-dataset-thresholds) when reproducing the package examples; the loader does not convert ratings to reach.

## License

MIT. See `LICENSE`. The data licenses are in `COPYRIGHTS`.

## Baselines and frontier (JavaScript 0.5.0)

These APIs are JavaScript-only. R and Python remain at 0.4.0. Build and pack this checkout at an exact reviewed commit to use them; 0.5.0 is not assumed to be published to npm or tagged. Record the source commit and tarball checksum with the consuming app.

```ts
import { turfBaselines, turfFrontier } from "turflp";
const reach = [[1, 0, 1], [1, 0, 0], [0, 1, 1]];
const baseline = await turfBaselines(reach, 2, { fixed: [0], seconds: 10 });
const frontier = await turfFrontier(reach, 2, { fixed: [0], seconds: 30, maxPoints: 40 });
```

Both functions validate the same reach matrix, size, names, and fixed-product constraints as `turf`. `seconds` must be nonnegative (Infinity removes the solve budget). `maxPoints` must be a positive safe integer. Preparation and solver loading are outside the solve budget. A synchronous solve blocks its thread; a worker is still required for a responsive application and hard cancellation.

`turfBaselines` returns `{ greedy, mostPopular, stop }`. Greedy adds the product with most additional reach, then most individual reach, then lowest column index. The most popular portfolio maximizes frequency and then reach. It is null if that search stops.

`turfFrontier` returns `{ points, maxFrequency, stop, penetrationLimited }`. Points run from maximum reach to maximum frequency; none can improve one measure without reducing the other. Each point has `products` (original 0-based indices), `reach`, `frequency`, and `penetration`. Penetration breaks ties at each reach/frequency pair. `penetrationLimited` means its pool search reached its limit, so do not claim exact penetration.

`stop` is `complete`, `time`, `cancelled`, `limit`, or `invalid`. A partial frontier contains only completed points; it is not the full frontier. `between?: () => Promise<boolean>` runs between solves; return false to stop. `onPoint?: (point) => void` receives an independent copy of each completed frontier point. Callback errors propagate. A caller cannot supply an unverified optimum or endpoint to skip solves.

The default baseline budget is 10 seconds. The default frontier budget is 30 seconds, with at most 40 points. Budgets start after preparation and solver loading. A time limit can return a partial frontier.
