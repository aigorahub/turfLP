# turfLP dashboard

A TURF analysis page that runs in the browser. It is one self-contained HTML file: the page, the turfLP JavaScript port, and the HiGHS WebAssembly solver are all inside it. Open the file in a browser; it needs no server and no network connection, and the data does not leave the computer.

The page has the seven example data sets of the package, and it reads your own CSV files. For each portfolio size, it shows the best portfolio, its reach, frequency, and penetration, a reach curve, and the reach of each product, with the selected portfolio marked. The results download as CSV.

## Build

The build uses the JavaScript package in `../js` and its `highs` dependency, so install that first. Node.js 20.19 or later.

```sh
cd turfLP/js && npm ci
cd ../dashboard && npm ci && npm run build
open dist/turflp-dashboard.html     # or double-click the file
```

`npm run build` writes `dist/turflp-dashboard.html` (about 1.9 MB). The file can be copied, sent, or put on any static web host. Each [GitHub release](https://github.com/aigorahub/turfLP/releases) from 0.2.0 on has the built file, so you can download it there and skip the build. The CI workflow `js.yaml` also builds it and keeps it as the `turflp-dashboard` artifact of each run.

## Data format

One row per respondent and one column per product. The first row holds the product names, and each name must be unique.

```csv
respondent,Product A,Product B,Product C
1,1,0,0
2,0,1,1
3,1,1,0
```

- The first column can be a respondent ID. The page finds it when its header is empty (as `write.csv()` in R writes row names) or a name such as `id` or `respondent`, when every value in it is text, or when its values are distinct whole numbers larger than every data value. A check box under the file summary changes the choice. Name the column `id` when the page does not find it.
- Values are 0 and 1, TRUE and FALSE, or yes and no, for reach data. Numbers other than 0 and 1 are ratings: choose the rating that counts as reached. The default is the top-2 box (the highest rating minus 1) on a whole-number scale, and the midpoint otherwise.
- Commas, semicolons, or tabs separate the values. With semicolons or tabs, a decimal comma is read as a decimal point. Quoted values and a byte order mark are read.
- Every cell needs a value. Empty cells and `NA` are errors: the page gives the line and the product, as it does for text that is not a value.
- The page reads files up to 50 MB and 2,000,000 values.

"Download a template" on the page gives a small example file.

## Run time

The solver runs in a Web Worker, so the page stays responsive, and each size appears when it is done. Cancel stops the run and keeps the sizes that are done. Small data sets such as the ice cream, ham, and coffee examples take less than a second for all sizes. The largest example, cafe drinks (2,500 respondents and 40 drinks), takes several seconds for each size from 3 on. "Browser or server" in [../js/README.md](../js/README.md) gives times for other problem sizes and says which problems to move to a server.

If the browser cannot start a worker, the page solves on its own thread and says so next to the solver status. The page then pauses while each size solves, and Cancel stops the run before the next size.

## Development

```sh
npm run typecheck      # the page and the tests
npm test               # CSV reading, summaries, formats, and the worker protocol (Vitest)
npm run build
npm run test:browser   # the built file in headless Chrome, with and without a worker
```

`test:browser` needs Chrome. It looks in the usual places; set `CHROME_PATH` otherwise.

The sources are in `src/`: `app.ts` (the page), `worker.ts` (the solver side), `csv.ts` (reading files), `data.ts` (examples and summaries), `charts.ts` (the reach curve and the product bars), and `index.html` and `styles.css`. `build.mjs` bundles them with esbuild and inlines `highs.wasm`, compressed with gzip.

## License

MIT, as the rest of the repository. The example data sets and their licenses are listed in [../js/COPYRIGHTS](../js/COPYRIGHTS); the page shows the source of each public data set.
