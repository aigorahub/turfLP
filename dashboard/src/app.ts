// The dashboard page: load data, choose settings, run turfLP in a worker, and
// show the results as they arrive.

import wasmGzipBase64 from "virtual:highs-wasm";
import workerSource from "virtual:worker-source";
import type { Criterion, Portfolio } from "../../js/src/index.js";
import { productBars, reachCurve } from "./charts.js";
import { DataError, defaultThreshold, parseTable, templateCsv, toReach, type Table } from "./csv.js";
import { EXAMPLES, exampleTable, resultsCsv, summarize, type Example, type ReachSummary,
         type SizeResult } from "./data.js";
import { count, decimal, list, percent, points, seconds } from "./format.js";
import type { Reply, Request } from "./worker.js";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_SIZE = 8;

const TIEBREAKS: { key: string; label: string; value: Criterion[] }[] = [
  { key: "fp", label: "Frequency, then penetration", value: ["frequency", "penetration"] },
  { key: "pf", label: "Penetration, then frequency", value: ["penetration", "frequency"] },
  { key: "f", label: "Frequency only", value: ["frequency"] },
  { key: "p", label: "Penetration only", value: ["penetration"] },
  { key: "none", label: "None (reach only)", value: [] },
];

// ---- Elements -------------------------------------------------------------

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const ui = {
  status: $("solver-status"),
  examples: $("examples"),
  drop: $("drop"),
  file: $<HTMLInputElement>("file"),
  template: $<HTMLButtonElement>("template"),
  dataError: $("data-error"),
  dataInfo: $("data-info"),
  settings: $<HTMLFieldSetElement>("settings"),
  thresholdNone: $("threshold-none"),
  thresholdBinary: $("threshold-binary"),
  thresholdRatings: $("threshold-ratings"),
  thresholdInput: $<HTMLInputElement>("threshold-input"),
  thresholdHint: $("threshold-hint"),
  sizeFrom: $<HTMLInputElement>("size-from"),
  sizeTo: $<HTMLInputElement>("size-to"),
  sizeHint: $("size-hint"),
  tiebreak: $<HTMLSelectElement>("tiebreak"),
  run: $<HTMLButtonElement>("run"),
  runHint: $("run-hint"),
  results: $("results"),
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string,
                                                   parent?: Element): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

// ---- State ----------------------------------------------------------------

interface Loaded {
  label: string;
  /** File name for a file, else null. */
  fileName: string | null;
  fileText: string | null;
  example: Example | null;
  table: Table;
}

interface Run {
  id: number;
  key: string;
  sizes: number[];
  results: Map<number, SizeResult>;
  status: "running" | "done" | "cancelled" | "error";
  message: string | null;
  current: number | null;
  currentStart: number;
  names: string[];
  summary: ReachSummary;
  respondents: number;
}

const state = {
  loaded: null as Loaded | null,
  threshold: 1,
  reach: null as Uint8Array | null,
  summary: null as ReachSummary | null,
  cover: null as Portfolio | null,
  coverError: null as string | null,
  coverId: 0,
  sizesTouched: false,
  tiebreak: "fp",
  run: null as Run | null,
  selected: null as number | null,
  solver: "loading" as "loading" | "ready" | "failed",
  solverMode: "worker" as "worker" | "page",
};

let nextId = 1;

function settingsKey(): string {
  return `${state.threshold}|${state.tiebreak}`;
}

// ---- Solver ---------------------------------------------------------------

const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
let wasm: Uint8Array | null = null;
let worker: Worker | null = null;
let page: typeof import("./worker.js") | null = null;
let pageQueue = Promise.resolve();
let pageStop = false;

async function inflate(base64: string): Promise<Uint8Array> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function startWorker(): Promise<void> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(workerUrl, { name: "turflp-solver" });
    } catch (e) {
      reject(e);
      return;
    }
    let ready = false;
    w.onmessage = (e: MessageEvent<Reply>) => {
      const r = e.data;
      if (!ready) {
        if (r.type === "ready") { ready = true; worker = w; resolve(); }
        else if (r.type === "error") { w.terminate(); reject(new Error(r.message)); }
        return;
      }
      if (w === worker) onReply(r);
    };
    w.onerror = (e) => {
      e.preventDefault();
      if (!ready) { w.terminate(); reject(new Error(e.message || "The solver worker did not start.")); }
      else if (w === worker) onReply({ type: "error", id: null, message: e.message || "The solver stopped." });
    };
    const copy = wasm!.slice();
    w.postMessage({ type: "load", wasm: copy } satisfies Request, [copy.buffer]);
  });
}

async function startPage(): Promise<void> {
  // The worker script also runs on the page, where it sets turflpSolver.
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = workerUrl;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("The solver script did not load."));
    document.head.appendChild(script);
  });
  page = (globalThis as unknown as { turflpSolver: typeof import("./worker.js") }).turflpSolver;
  await new Promise<void>((resolve, reject) => {
    void page!.handle({ type: "load", wasm: wasm! }, (r) => {
      if (r.type === "ready") resolve();
      else if (r.type === "error") reject(new Error(r.message));
    });
  });
}

async function startSolver(): Promise<void> {
  try {
    wasm ??= await inflate(wasmGzipBase64);
    try {
      await startWorker();
      state.solverMode = "worker";
    } catch (e) {
      console.warn("turfLP: the solver worker did not start; solving on the page.", e);
      await startPage();
      state.solverMode = "page";
    }
    state.solver = "ready";
  } catch (e) {
    state.solver = "failed";
    ui.status.textContent = `The solver could not start: ${e instanceof Error ? e.message : String(e)}`;
    ui.status.classList.add("is-error");
    render();
    return;
  }
  render();
  requestCover();
}

function send(req: Request): void {
  if (worker) {
    worker.postMessage(req);
  } else if (page) {
    const mod = page;
    pageQueue = pageQueue.then(() => {
      pageStop = false;
      return mod.handle(req,
        (r) => { setTimeout(() => onReply(r), 0); },
        // Pause before each size so the page can draw and take a click on Cancel.
        () => new Promise((res) => setTimeout(() => res(!pageStop), 20)));
    });
  }
}

/** Stop the solve in progress. A worker is replaced; on the page, the run stops before its next size. */
function stopSolver(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    state.solver = "loading";
    startWorker().then(() => {
      state.solver = "ready";
      render();
      if (!state.cover && !state.coverError) requestCover();
    }, (e) => {
      state.solver = "failed";
      ui.status.textContent = `The solver could not restart: ${e instanceof Error ? e.message : String(e)}`;
      render();
    });
  } else {
    pageStop = true;
  }
}

function requestCover(): void {
  if (!state.loaded || !state.reach || state.solver !== "ready") return;
  state.coverId = nextId++;
  const t = state.loaded.table;
  send({ type: "cover", id: state.coverId,
         matrix: { rows: t.rows, cols: t.cols, data: state.reach, names: t.names } });
}

function onReply(r: Reply): void {
  if (r.type === "cover") {
    if (r.id !== state.coverId) return;
    state.cover = r.portfolio;
    if (!state.sizesTouched && state.loaded) {
      ui.sizeFrom.value = "1";
      ui.sizeTo.value = String(Math.min(r.portfolio.size, DEFAULT_MAX_SIZE, state.loaded.table.cols));
    }
    render();
    return;
  }
  if (r.type === "error" && r.id !== null && r.id === state.coverId) {
    state.coverError = r.message;
    render();
    return;
  }
  const run = state.run;
  if (!run || run.status !== "running" || r.type === "ready" || (r.id !== null && r.id !== run.id)) return;
  if (r.type === "start") {
    run.current = r.size;
    run.currentStart = performance.now();
  } else if (r.type === "size") {
    run.results.set(r.portfolio.size, { portfolio: r.portfolio, seconds: r.seconds });
    run.current = null;
  } else if (r.type === "done") {
    run.status = "done";
    run.current = null;
  } else if (r.type === "error") {
    run.status = "error";
    run.message = r.message;
    run.current = null;
  }
  render();
}

// ---- Data -----------------------------------------------------------------

function setData(loaded: Loaded, threshold: number): void {
  if (state.run?.status === "running") stopSolver();
  state.loaded = loaded;
  state.run = null;
  state.selected = null;
  state.sizesTouched = false;
  ui.dataError.hidden = true;
  renderDataInfo();
  const cols = loaded.table.cols;
  ui.sizeFrom.value = "1";
  ui.sizeTo.value = String(Math.min(DEFAULT_MAX_SIZE, cols));
  ui.sizeFrom.max = ui.sizeTo.max = String(cols);
  setThreshold(threshold);
}

function setThreshold(threshold: number): void {
  const t = state.loaded!.table;
  if (state.run?.status === "running") cancelRun();
  state.threshold = threshold;
  state.reach = toReach(t, threshold);
  state.summary = summarize(state.reach, t.rows, t.cols);
  state.cover = null;
  state.coverError = null;
  requestCover();
  render();
}

function loadExample(ex: Example): void {
  const table = exampleTable(ex.id);
  setData({ label: ex.title, fileName: null, fileText: null, example: ex, table },
          ex.threshold ?? defaultThreshold(table));
}

function showDataError(message: string): void {
  ui.dataError.textContent = message;
  ui.dataError.hidden = false;
}

async function loadFile(file: File): Promise<void> {
  if (file.size > MAX_FILE_BYTES) {
    showDataError(`${file.name} is ${(file.size / 1024 / 1024).toFixed(0)} MB. The dashboard reads files up to 50 MB.`);
    return;
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    showDataError(`${file.name} could not be read.`);
    return;
  }
  parseAndLoad(file.name, text, undefined);
}

function parseAndLoad(fileName: string, text: string, idColumn: boolean | undefined): void {
  try {
    const table = parseTable(text, { idColumn });
    setData({ label: fileName, fileName, fileText: text, example: null, table }, defaultThreshold(table));
  } catch (e) {
    if (e instanceof DataError) showDataError(`${fileName}: ${e.message}`);
    else showDataError(`${fileName} could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = el("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Run ------------------------------------------------------------------

function sizeRange(): { sizes: number[] } | { error: string } {
  const cols = state.loaded?.table.cols ?? 0;
  const from = Number(ui.sizeFrom.value);
  const to = Number(ui.sizeTo.value);
  if (!Number.isInteger(from) || !Number.isInteger(to) || ui.sizeFrom.value === "" || ui.sizeTo.value === "") {
    return { error: "Sizes must be whole numbers." };
  }
  if (from < 1 || to > cols) return { error: `Sizes must be from 1 to ${cols}, the number of products.` };
  if (from > to) return { error: "The first size must not be larger than the last." };
  return { sizes: Array.from({ length: to - from + 1 }, (_, k) => from + k) };
}

function startRun(): void {
  const range = sizeRange();
  if (!state.loaded || !state.reach || !state.summary || "error" in range) return;
  const t = state.loaded.table;
  const tiebreak = TIEBREAKS.find((x) => x.key === state.tiebreak)!.value;
  state.run = {
    id: nextId++, key: settingsKey(), sizes: range.sizes, results: new Map(), status: "running",
    message: null, current: null, currentStart: performance.now(), names: t.names,
    summary: state.summary, respondents: t.rows,
  };
  state.selected = null;
  send({ type: "run", id: state.run.id, sizes: range.sizes, tiebreak,
         matrix: { rows: t.rows, cols: t.cols, data: state.reach, names: t.names } });
  render();
}

function cancelRun(): void {
  if (!state.run || state.run.status !== "running") return;
  state.run.status = "cancelled";
  state.run.current = null;
  stopSolver();
  render();
}

// ---- Rendering ------------------------------------------------------------

function renderStatus(): void {
  if (state.solver === "failed") return;
  ui.status.classList.remove("is-error");
  ui.status.textContent = state.solver === "loading" ? "Loading the solver…"
    : state.solverMode === "page" ? "Solver ready. It runs on the page, so the page can pause during a run."
    : "Solver ready";
}

const exampleButtons = new Map<string, HTMLButtonElement>();

/** Build the example buttons once, so that focus and references survive a render. */
function buildExamples(): void {
  for (const ex of EXAMPLES) {
    const t = exampleTable(ex.id);
    const b = el("button", "example", undefined, ui.examples);
    b.type = "button";
    el("span", "example-title", ex.title, b);
    el("span", "example-size", `${count(t.rows)} \u00d7 ${t.cols}`, b);
    b.title = ex.description;
    b.addEventListener("click", () => loadExample(ex));
    exampleButtons.set(ex.id, b);
  }
}

function renderExamples(): void {
  for (const [id, b] of exampleButtons) {
    b.setAttribute("aria-pressed", String(state.loaded?.example?.id === id));
  }
}

function renderDataInfo(): void {
  ui.dataInfo.replaceChildren();
  const l = state.loaded;
  if (!l) { ui.dataInfo.hidden = true; return; }
  ui.dataInfo.hidden = false;
  const t = l.table;
  el("p", "data-name", l.label, ui.dataInfo);
  const kind = t.kind === "binary" ? "0/1 values"
    : `ratings from ${formatValue(t.min)} to ${formatValue(t.max)}`;
  el("p", "muted", `${count(t.rows)} respondents, ${t.cols} products, ${kind}.`, ui.dataInfo);
  if (l.example) {
    el("p", "muted", l.example.description, ui.dataInfo);
    if (l.example.source) {
      const p = el("p", "muted", "Source: ", ui.dataInfo);
      const a = el("a", undefined, l.example.source.text, p);
      a.href = l.example.source.url;
      a.target = "_blank";
      a.rel = "noopener";
    }
  }
  if (l.fileText !== null) {
    const label = el("label", "check", undefined, ui.dataInfo);
    const box = el("input", undefined, undefined, label);
    box.type = "checkbox";
    box.checked = t.idColumn !== null;
    label.append(t.idColumn !== null
      ? ` First column (${t.idColumn === "" ? "no name" : `“${t.idColumn}”`}) is a respondent ID`
      : " First column is a respondent ID");
    box.addEventListener("change", () => parseAndLoad(l.fileName!, l.fileText!, box.checked));
  }
}

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function renderSettings(): void {
  const l = state.loaded;
  ui.settings.disabled = !l;
  ui.thresholdNone.hidden = !!l;
  ui.thresholdBinary.hidden = l?.table.kind !== "binary";
  ui.thresholdRatings.hidden = l?.table.kind !== "ratings";
  if (l?.table.kind === "ratings") {
    const t = l.table;
    const input = ui.thresholdInput;
    input.min = String(t.min);
    input.max = String(t.max);
    input.step = t.integer ? "1" : "any";
    // Do not overwrite a value that the user is typing.
    if (document.activeElement !== input) input.value = String(state.threshold);
    const top2 = t.integer && state.threshold === t.max - 1 ? ` ${formatValue(t.max - 1)} is the top-2 box.` : "";
    ui.thresholdHint.textContent = `Ratings run from ${formatValue(t.min)} to ${formatValue(t.max)}.${top2}`;
  }

  // Sizes
  ui.sizeHint.classList.remove("is-error");
  const range = l ? sizeRange() : null;
  if (!l) {
    ui.sizeHint.textContent = "";
  } else if (range && "error" in range) {
    ui.sizeHint.textContent = range.error;
    ui.sizeHint.classList.add("is-error");
  } else if (state.coverError) {
    ui.sizeHint.textContent = state.coverError === "No product reaches any respondent."
      ? "No product reaches any respondent. Lower the threshold."
      : state.coverError;
    ui.sizeHint.classList.add("is-error");
  } else if (state.cover) {
    const k = state.cover.size;
    ui.sizeHint.textContent = `${k} ${k === 1 ? "product reaches" : "products reach"} every respondent that any product reaches.`;
  } else {
    ui.sizeHint.textContent = "Finding the smallest full cover…";
  }

  // Run button
  const running = state.run?.status === "running";
  ui.run.textContent = running ? "Cancel" : "Run";
  ui.run.classList.toggle("is-cancel", running);
  const canRun = !!l && state.solver === "ready" && !!range && !("error" in range) && !state.coverError;
  ui.run.disabled = !running && !canRun;
  ui.runHint.textContent = !l ? "" : state.solver === "loading" ? "Waiting for the solver…"
    : state.solver === "failed" ? "The solver is not available."
    : running ? "Cancel keeps the sizes that are done." : "";
}

function renderResults(): void {
  const host = ui.results;
  host.replaceChildren();
  lastDraw = null;
  host.classList.remove("is-stale");
  const l = state.loaded;
  if (!l || !state.summary) {
    const empty = el("div", "empty", undefined, host);
    el("h2", undefined, "Find the products that reach the most people", empty);
    el("p", undefined,
      "Load an example data set, or drop a CSV file with one row per respondent and one column per product. " +
      "The analysis runs in this browser. Your data does not leave this device.", empty);
    return;
  }
  const run = state.run;
  if (!run) {
    renderPreview(host, l, state.summary);
    return;
  }
  const stale = run.key !== settingsKey() && run.status !== "running";
  if (stale) {
    el("p", "notice", "The settings changed after this run. Run again to update the results.", host);
    host.classList.add("is-stale");
  }
  const done = run.sizes.filter((s) => run.results.has(s));
  const shown = state.selected !== null && run.results.has(state.selected) ? state.selected
    : done.length ? done[done.length - 1] : null;

  const head = el("section", "headline", undefined, host);
  if (shown === null) {
    if (run.status === "running") {
      const k = run.current ?? run.sizes[0];
      el("h2", "headline-title", `Finding the best portfolio of ${k} ${k === 1 ? "product" : "products"}…`, head);
      el("p", "muted", "Results appear here one size at a time.", head);
    } else {
      el("h2", "headline-title", run.status === "error" ? "The run stopped with an error" : "The run was cancelled", head);
    }
  } else {
    const p = run.results.get(shown)!.portfolio;
    el("h2", "headline-title",
       `${p.size} ${p.size === 1 ? "product reaches" : "products reach"} ${percent(p.reachProp)} of respondents`, head);
    el("p", "headline-products", list(p.names), head);
    const stats = el("p", "headline-stats", undefined, head);
    el("span", undefined, `${count(p.reach)} of ${count(p.respondents)} respondents`, stats);
    el("span", undefined, `Frequency ${count(p.frequency)}`, stats);
    el("span", undefined, `Penetration ${decimal(p.penetration)}`, stats);
    if (p.reach === run.summary.reachable) {
      el("p", "muted", "This portfolio reaches every respondent that any product reaches.", head);
    }
  }
  if (run.status === "error" && run.message) el("p", "error", run.message, head);

  // Reach curve
  const curveSection = el("section", "panel-block", undefined, host);
  const curveHead = el("div", "block-head", undefined, curveSection);
  el("h3", undefined, "Reach by portfolio size", curveHead);
  el("p", "muted", "Select a point or a row to show that portfolio.", curveHead);
  const curve = el("div", "chart", undefined, curveSection);
  const draw = () => reachCurve(curve, {
    sizes: run.sizes,
    points: done.map((s) => {
      const p = run.results.get(s)!.portfolio;
      return { size: s, reach: p.reach, reachProp: p.reachProp, names: p.names };
    }),
    respondents: run.respondents,
    reachable: run.summary.reachable / run.respondents,
    selected: shown,
    onSelect: select,
  });
  // The host is in the document, so its width is known now.
  draw();
  lastDraw = draw;

  // Table
  const tableSection = el("section", "panel-block", undefined, host);
  const tableHead = el("div", "block-head", undefined, tableSection);
  el("h3", undefined, "Best portfolio for each size", tableHead);
  const exportButton = el("button", "button-secondary", "Download CSV", tableHead);
  exportButton.type = "button";
  exportButton.disabled = done.length === 0;
  exportButton.addEventListener("click", () => {
    const slug = (l.example?.id ?? l.label.replace(/\.[^.]+$/, "")).replace(/[^\w-]+/g, "-");
    download(`turf-${slug}.csv`, resultsCsv(done.map((s) => run.results.get(s)!)));
  });
  renderTable(el("div", "table-wrap", undefined, tableSection), run, shown);

  const warnings = done.flatMap((s) => run.results.get(s)!.portfolio.warnings.map((w) => `Size ${s}: ${w}`));
  if (warnings.length) {
    const w = el("section", "warnings", undefined, host);
    el("h3", undefined, "Warnings", w);
    const ul = el("ul", undefined, undefined, w);
    for (const text of warnings) el("li", undefined, text, ul);
  }

  // Product bars
  const selectedSet = shown === null ? null : new Set(run.results.get(shown)!.portfolio.products);
  const bars = el("section", "panel-block", undefined, host);
  const barsHead = el("div", "block-head", undefined, bars);
  el("h3", undefined, "Reach of each product", barsHead);
  if (selectedSet) {
    const legend = el("p", "legend", undefined, barsHead);
    el("span", "swatch swatch-in", undefined, legend);
    legend.append(`In the ${shown}-product portfolio`);
    el("span", "swatch swatch-out", undefined, legend);
    legend.append("Not in it");
  }
  const barsHost = el("div", "bars-host", undefined, bars);
  productBars(barsHost, {
    names: run.names, productReach: run.summary.productReach, respondents: run.respondents,
    selected: selectedSet,
  });
}

let lastDraw: (() => void) | null = null;

function renderTable(host: HTMLElement, run: Run, shown: number | null): void {
  const table = el("table", "results-table", undefined, host);
  const thead = el("thead", undefined, undefined, table);
  const hr = el("tr", undefined, undefined, thead);
  const heads: [string, string, string?][] = [
    ["Size", "num"], ["Reach", "num"], ["Gain", "num", "Reach gained over the previous size"],
    ["Frequency", "num", "Sum of the individual reach of the products"],
    ["Penetration", "num", "Harmonic mean of the individual reach of the products"],
    ["Products", "text"], ["Time", "num"],
  ];
  for (const [text, cls, title] of heads) {
    const th = el("th", cls, text, hr);
    th.scope = "col";
    if (title) th.title = title;
  }
  const tbody = el("tbody", undefined, undefined, table);
  for (const s of run.sizes) {
    const r = run.results.get(s);
    const tr = el("tr", undefined, undefined, tbody);
    if (!r) {
      tr.className = "is-pending";
      el("td", "num", String(s), tr);
      if (run.current === s) {
        const td = el("td", "text", "Solving…", tr);
        td.colSpan = 5;
        const time = el("td", "num live-time", seconds((performance.now() - run.currentStart) / 1000), tr);
        time.dataset.start = String(run.currentStart);
      } else if (run.status === "running") {
        for (let k = 0; k < 6; k++) el("span", "skeleton", undefined, el("td", k === 4 ? "text" : "num", undefined, tr));
      } else {
        const td = el("td", "text muted", run.status === "cancelled" ? "Cancelled" : "Not solved", tr);
        td.colSpan = 6;
      }
      continue;
    }
    const p = r.portfolio;
    const prev = run.results.get(s - 1)?.portfolio;
    tr.tabIndex = 0;
    if (s === shown) tr.className = "is-selected";
    tr.setAttribute("aria-selected", String(s === shown));
    el("td", "num", String(s), tr);
    const reach = el("td", "num", undefined, tr);
    reach.append(percent(p.reachProp), " ");
    el("span", "sub", `(${count(p.reach)})`, reach);
    el("td", "num", prev ? points(p.reachProp - prev.reachProp).replace(" points", "") : "", tr);
    el("td", "num", count(p.frequency), tr);
    el("td", "num", decimal(p.penetration), tr);
    el("td", "text products", p.names.join(", "), tr);
    el("td", "num muted", seconds(r.seconds), tr);
    tr.addEventListener("click", () => select(s));
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(s); }
    });
  }
}

function renderPreview(host: HTMLElement, l: Loaded, summary: ReachSummary): void {
  const t = l.table;
  const head = el("section", "headline", undefined, host);
  el("h2", "headline-title", l.label, head);
  const none = t.rows - summary.reachable;
  el("p", "muted",
     none === 0 ? `Every one of the ${count(t.rows)} respondents is reached by at least one product.`
       : `${count(none)} of ${count(t.rows)} respondents ${none === 1 ? "is" : "are"} reached by no product, ` +
         `so the highest possible reach is ${percent(summary.reachable / t.rows)}.`, head);
  el("p", "muted", "Choose the sizes and press Run to find the best portfolio for each size.", head);
  const bars = el("section", "panel-block", undefined, host);
  el("h3", undefined, "Reach of each product", el("div", "block-head", undefined, bars));
  productBars(el("div", "bars-host", undefined, bars), {
    names: t.names, productReach: summary.productReach, respondents: t.rows, selected: null,
  });
}

/** Show the portfolio of one size. Keyboard focus stays on the row or point that was used. */
function select(size: number): void {
  state.selected = size;
  const focused = document.activeElement;
  const wasRow = focused instanceof HTMLTableRowElement;
  const wasPoint = focused instanceof SVGElement && focused.classList.contains("hit");
  render();
  if (wasRow) (ui.results.querySelector("tr.is-selected") as HTMLElement | null)?.focus();
  if (wasPoint) (ui.results.querySelector(`.curve .hit[data-size="${size}"]`) as SVGElement | null)?.focus();
}

function render(): void {
  renderStatus();
  renderExamples();
  renderSettings();
  renderResults();
}

// Live time of the running size.
setInterval(() => {
  for (const cell of ui.results.querySelectorAll<HTMLElement>(".live-time")) {
    cell.textContent = seconds((performance.now() - Number(cell.dataset.start)) / 1000);
  }
}, 200);

let lastWidth = 0;
new ResizeObserver(() => {
  if (ui.results.clientWidth === lastWidth) return;
  lastWidth = ui.results.clientWidth;
  lastDraw?.();
}).observe(ui.results);

// ---- Events ---------------------------------------------------------------

for (const t of TIEBREAKS) {
  const o = el("option", undefined, t.label, ui.tiebreak);
  o.value = t.key;
}
ui.tiebreak.value = state.tiebreak;

ui.thresholdInput.addEventListener("change", () => {
  const input = ui.thresholdInput;
  const v = Number(input.value);
  if (input.value.trim() === "" || !Number.isFinite(v)) { input.value = String(state.threshold); return; }
  if (v !== state.threshold) setThreshold(v);
});
ui.tiebreak.addEventListener("change", () => {
  if (state.run?.status === "running") cancelRun();
  state.tiebreak = ui.tiebreak.value;
  render();
});

for (const input of [ui.sizeFrom, ui.sizeTo]) {
  input.addEventListener("input", () => { state.sizesTouched = true; renderSettings(); });
}

ui.run.addEventListener("click", () => {
  if (state.run?.status === "running") cancelRun();
  else startRun();
});

ui.file.addEventListener("change", () => {
  const f = ui.file.files?.[0];
  if (f) void loadFile(f);
  ui.file.value = "";
});

ui.template.addEventListener("click", () => download("turf-template.csv", templateCsv()));

let dragDepth = 0;
ui.drop.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; ui.drop.classList.add("is-over"); });
ui.drop.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; ui.drop.classList.remove("is-over"); } });
ui.drop.addEventListener("dragover", (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; });
ui.drop.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  ui.drop.classList.remove("is-over");
  const f = e.dataTransfer?.files?.[0];
  if (f) void loadFile(f);
});
// A file dropped outside the drop zone must not open in the tab.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

buildExamples();
render();
void startSolver();
