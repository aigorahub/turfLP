// Build dist/turflp-dashboard.html: one self-contained file with the page, the
// solver worker, and highs.wasm (gzip-compressed, base64-encoded) inlined.
// Also build dist/site, the directory for a web host: the same page as
// index.html, with the icons and the link preview image from site/.
// Run `npm ci` in ../js first: the solver comes from ../js/src and its
// `highs` dependency from ../js/node_modules.

import { build, transform } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "src");
const site = join(here, "site");
const out = join(here, "dist", "turflp-dashboard.html");
const hosted = join(here, "dist", "site");
const requireFromJs = createRequire(join(here, "..", "js", "package.json"));

let wasmPath;
try {
  wasmPath = requireFromJs.resolve("highs/runtime");
} catch {
  console.error("highs is not installed. Run `npm ci` in ../js first.");
  process.exit(1);
}

const common = { bundle: true, platform: "browser", target: "es2022", minify: true, legalComments: "none" };

// The worker is a classic script, not a module: Chrome does not start a
// module worker from a page opened as a file. The script also sets the global
// turflpSolver, which the page uses when it cannot start a worker. The highs
// loader reads import.meta and imports node:* modules only on Node.js.
const worker = await build({
  ...common,
  entryPoints: [join(src, "worker.ts")],
  format: "iife",
  globalName: "turflpSolver",
  external: ["node:*"],
  logOverride: { "empty-import-meta": "silent" },
  write: false,
});
const workerSource = worker.outputFiles[0].text;

const wasmBase64 = gzipSync(readFileSync(wasmPath), { level: 9 }).toString("base64");

const virtual = {
  name: "virtual",
  setup(b) {
    b.onResolve({ filter: /^virtual:/ }, (args) => ({ path: args.path, namespace: "virtual" }));
    b.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
      if (args.path === "virtual:highs-wasm") return { contents: `export default ${JSON.stringify(wasmBase64)};`, loader: "js" };
      if (args.path === "virtual:worker-source") return { contents: `export default ${JSON.stringify(workerSource)};`, loader: "js" };
      return null;
    });
  },
};

const app = await build({
  ...common,
  entryPoints: [join(src, "app.ts")],
  format: "esm",
  plugins: [virtual],
  write: false,
});
// "</script" inside the inlined code would end the script element.
const script = app.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

// The Aigora fonts go into the page as data URLs, so the page works offline.
const brand = join(src, "brand");
const font = (file) => `url(data:font/woff2;base64,${readFileSync(join(brand, file)).toString("base64")}) format("woff2")`;
const fontFaces =
  `@font-face{font-family:"Manrope";src:${font("Manrope-Regular.woff2")};font-weight:100 800;font-display:swap}` +
  `@font-face{font-family:"Instrument Serif";src:${font("InstrumentSerif-Italic.woff2")};font-weight:400;font-style:italic;font-display:swap}`;
const css = fontFaces +
  (await transform(readFileSync(join(src, "styles.css"), "utf8"), { loader: "css", minify: true })).code;

// The icon and the Aigora mark go into the page as data URLs, so that the file needs no other file.
const svgUrl = (path) => "data:image/svg+xml," + readFileSync(path, "utf8")
  .trim().replace(/>\s+</g, "><").replace(/"/g, "'").replace(/[%#<>]/g, encodeURIComponent);
const favicon = svgUrl(join(site, "favicon.svg"));
const logo = svgUrl(join(brand, "aigora-mark-light.svg"));

const template = readFileSync(join(src, "index.html"), "utf8");
if (!["/* styles */", "/* script */", "{{version}}", "{{favicon}}", "{{logo}}"].every((p) => template.includes(p))) {
  throw new Error("index.html is missing a placeholder.");
}
// The version of the JavaScript port, shown next to the name.
const version = JSON.parse(readFileSync(join(here, "..", "js", "package.json"), "utf8")).version;
const page = template
  .replace("{{version}}", () => version)
  .replace("{{favicon}}", () => favicon)
  .replace("{{logo}}", () => logo)
  .replace("/* styles */", () => css.trim())
  .replace("/* script */", () => script.trim());

mkdirSync(hosted, { recursive: true });
writeFileSync(out, page);
writeFileSync(join(hosted, "index.html"), page);
for (const name of ["og.png", "apple-touch-icon.png", "favicon.ico"]) copyFileSync(join(site, name), join(hosted, name));
console.log(`${out} (${(statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
console.log(hosted);
