// The dashboard page: load data, choose settings, run turfLP in a worker, and
// show the results as they arrive.

import wasmGzipBase64 from "virtual:highs-wasm";
import workerSource from "virtual:worker-source";
import type { Criterion, Portfolio } from "../../js/src/index.js";
import type { Point, StageInfo, Stop } from "./analysis.js";
import { PRODUCT_COLORS, stackColumns } from "./contrib.js";
import { contributionList, frontierChart, productBars, reachColumns, reachCurve, type Column } from "./charts.js";
import { DataError, defaultThreshold, parseTable, templateCsv, toReach, type Table } from "./csv.js";
import { EXAMPLES, exampleTable, resultsCsv, summarize, type Example, type ReachSummary,
         type SizeResult } from "./data.js";
import { count, decimal, list, percent, points, seconds } from "./format.js";
import type { Reply, Request } from "./worker.js";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_SIZE = 8;
// Above this many products, the fixed-product list gets a filter.
const FIXED_FILTER_FROM = 13;

const CRITERION_LABEL: Record<"reach" | Criterion, string> = {
  reach: "Reach", frequency: "Frequency", penetration: "Penetration",
};
// Seconds for each part of the deep dive into one size.
const ANALYSIS_SECONDS = { baselines: 10, stages: 15, frontier: 30 };
const MAX_FRONTIER_POINTS = 40;

// Elements

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
  fixedFilter: $<HTMLInputElement>("fixed-filter"),
  fixedList: $("fixed-list"),
  fixedHint: $("fixed-hint"),
  fixedClear: $<HTMLButtonElement>("fixed-clear"),
  stage2: $<HTMLSelectElement>("stage2"),
  stage3: $<HTMLSelectElement>("stage3"),
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

// State

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
  /** The reach matrix, tie-break, and fixed products of the run, kept for the analysis of its portfolios. */
  reach: Uint8Array;
  cols: number;
  tiebreak: Criterion[];
  fixed: number[];
  analyses: Map<number, Analysis>;
}

/** The deep dive into the portfolio of one size: simple choices, stages, and the trade-off frontier. */
interface Analysis {
  id: number;
  size: number;
  status: "running" | "done" | "error";
  mostPopular: Point | null;
  greedy: Point | null;
  baselinesStop: Stop | null;
  stages: StageInfo[] | null;
  stagesStop: Stop | null;
  points: Point[];
  maxFrequency: number | null;
  frontierStop: Stop | null;
  message: string | null;
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
  tiebreak: ["frequency", "penetration"] as Criterion[],
  /** Columns that every portfolio must contain, ascending. */
  fixed: [] as number[],
  /** Why products were unfixed, after a threshold change. */
  fixedNote: null as string | null,
  // Order of the fixed-product list: column order until a heading is clicked.
  fixedSort: null as { key: "name" | "reach"; desc: boolean } | null,
  run: null as Run | null,
  selected: null as number | null,
  chartMode: "line" as "line" | "columns",
  /** Index of the selected frontier point, for the size shown. */
  frontierSelected: null as number | null,
  solver: "loading" as "loading" | "ready" | "failed",
  solverMode: "worker" as "worker" | "page",
};

let nextId = 1;

function settingsKey(): string {
  return `${state.threshold}|${state.tiebreak.join(",")}|${state.fixed.join(",")}`;
}

// Solver

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
      if (!ready) { w.terminate(); reject(new Error(e.message || "The solver worker did not start.")); return; }
      if (w !== worker) return;
      // The worker failed after it started: stop the run and start a new worker.
      onReply({ type: "error", id: null, message: e.message || "The solver stopped." });
      stopSolver();
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

const pageCancelled = new Set<number>();

function send(req: Request): void {
  if (worker) {
    worker.postMessage(req);
  } else if (page) {
    if (req.type === "cancel") { pageCancelled.add(req.id); return; }
    const mod = page;
    pageQueue = pageQueue.then(() => {
      pageStop = false;
      return mod.handle(req,
        (r) => { setTimeout(() => onReply(r), 0); },
        // Pause before each size or solve so the page can draw and take a click on Cancel.
        () => new Promise((res) => setTimeout(() => res(!pageStop &&
          !(req.type === "analyze" && pageCancelled.has(req.id))), 20)));
    });
  }
}

/** Stop the solve in progress. A worker is replaced; on the page, the run stops before its next size. */
function stopSolver(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    state.solver = "loading";
    // Show the loading state now, so Run is disabled until the new worker is ready.
    render();
    // The analysis in progress stops with the worker; it runs again when asked.
    for (const a of state.run?.analyses.values() ?? []) if (a.status === "running") state.run!.analyses.delete(a.size);
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
  send({ type: "cover", id: state.coverId, fixed: [...state.fixed],
         matrix: { rows: t.rows, cols: t.cols, data: state.reach, names: t.names } });
}

function onReply(r: Reply): void {
  if (r.type === "cover") {
    if (r.id !== state.coverId) return;
    state.cover = r.portfolio;
    // Do not change the sizes of a run in progress.
    if (!state.sizesTouched && state.loaded && state.run?.status !== "running") {
      const from = Math.max(1, state.fixed.length);
      ui.sizeFrom.value = String(from);
      ui.sizeTo.value = String(Math.max(from, Math.min(r.portfolio.size, DEFAULT_MAX_SIZE, state.loaded.table.cols)));
    }
    render();
    return;
  }
  if (r.type === "error" && r.id !== null && r.id === state.coverId) {
    state.coverError = r.message;
    render();
    return;
  }
  const analysis = r.type !== "ready" && r.id !== null
    ? [...state.run?.analyses.values() ?? []].find((a) => a.id === r.id) : undefined;
  if (analysis) {
    if (r.type === "baselines") {
      analysis.mostPopular = r.mostPopular;
      analysis.greedy = r.greedy;
      analysis.baselinesStop = r.stop;
      if (r.stop === "cancelled") analysis.status = "done";
    } else if (r.type === "stages") {
      analysis.stages = r.stages;
      analysis.stagesStop = r.stop;
      if (r.stop === "cancelled") analysis.status = "done";
    } else if (r.type === "point") {
      analysis.points.push(r.point);
    } else if (r.type === "frontier") {
      analysis.points = r.points;
      analysis.maxFrequency = r.maxFrequency;
      analysis.frontierStop = r.stop;
      analysis.status = "done";
    } else if (r.type === "error") {
      analysis.status = "error";
      analysis.message = r.message;
    }
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

// Data

function setData(loaded: Loaded, threshold: number): void {
  if (state.run?.status === "running") stopSolver();
  cancelAnalyses();
  state.loaded = loaded;
  state.run = null;
  state.selected = null;
  state.sizesTouched = false;
  // Fixed products are columns of the old table.
  state.fixed = [];
  ui.fixedFilter.value = "";
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
  // The run is out of date now; its analysis would delay the new cover.
  cancelAnalyses();
  state.threshold = threshold;
  state.reach = toReach(t, threshold);
  state.summary = summarize(state.reach, t.rows, t.cols);
  // A product that reaches no one at this threshold cannot be fixed.
  const reach = state.summary.productReach;
  const dropped = state.fixed.filter((j) => reach[j] === 0);
  state.fixed = state.fixed.filter((j) => reach[j] > 0);
  state.fixedNote = dropped.length === 0 ? null
    : `${list(dropped.map((j) => t.names[j]))} ${dropped.length === 1 ? "reaches" : "reach"} no respondent at this threshold, ` +
      `so ${dropped.length === 1 ? "it is" : "they are"} no longer fixed.`;
  if (dropped.length && !state.sizesTouched) ui.sizeFrom.value = String(Math.max(1, state.fixed.length));
  buildFixedList();
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

// Run

function sizeRange(): { sizes: number[] } | { error: string } {
  const cols = state.loaded?.table.cols ?? 0;
  const from = Number(ui.sizeFrom.value);
  const to = Number(ui.sizeTo.value);
  if (!Number.isInteger(from) || !Number.isInteger(to) || ui.sizeFrom.value === "" || ui.sizeTo.value === "") {
    return { error: "Sizes must be whole numbers." };
  }
  if (from < 1 || to > cols) return { error: `Sizes must be from 1 to ${cols}, the number of products.` };
  const f = state.fixed.length;
  if (from < f) return { error: `With ${f} fixed products, the smallest size is ${f}.` };
  if (from > to) return { error: "The first size must not be larger than the last." };
  return { sizes: Array.from({ length: to - from + 1 }, (_, k) => from + k) };
}

function startRun(): void {
  const range = sizeRange();
  if (state.solver !== "ready" || !state.loaded || !state.reach || !state.summary || "error" in range) return;
  const t = state.loaded.table;
  const tiebreak = [...state.tiebreak];
  const fixed = [...state.fixed];
  cancelAnalyses();
  state.run = {
    id: nextId++, key: settingsKey(), sizes: range.sizes, results: new Map(), status: "running",
    message: null, current: null, currentStart: performance.now(), names: t.names,
    summary: state.summary, respondents: t.rows,
    reach: state.reach, cols: t.cols, tiebreak, fixed, analyses: new Map(),
  };
  state.selected = null;
  state.frontierSelected = null;
  send({ type: "run", id: state.run.id, sizes: range.sizes, tiebreak, fixed,
         matrix: { rows: t.rows, cols: t.cols, data: state.reach, names: t.names } });
  render();
}

/** Stop the deep dive in progress, if any. */
function cancelAnalyses(except?: number): void {
  const run = state.run;
  if (!run) return;
  for (const a of [...run.analyses.values()]) {
    if (a.status === "running" && a.size !== except) {
      send({ type: "cancel", id: a.id });
      run.analyses.delete(a.size);
    }
  }
}

/** Start the deep dive into the portfolio of one size of a finished run. */
function requestAnalysis(run: Run, size: number): void {
  if (run.status === "running" || state.solver !== "ready") return;
  // Stop the analysis of another size, also when this size is done already.
  cancelAnalyses(size);
  const result = run.results.get(size);
  if (!result || run.analyses.has(size)) return;
  const a: Analysis = {
    id: nextId++, size, status: "running", mostPopular: null, greedy: null, baselinesStop: null,
    stages: null, stagesStop: null, points: [],
    maxFrequency: null, frontierStop: null, message: null,
  };
  run.analyses.set(size, a);
  send({ type: "analyze", id: a.id, products: [...result.portfolio.products], tiebreak: run.tiebreak, fixed: run.fixed,
         optimal: result.portfolio.warnings.length === 0,
         seconds: ANALYSIS_SECONDS, maxPoints: MAX_FRONTIER_POINTS,
         matrix: { rows: run.respondents, cols: run.cols, data: run.reach, names: run.names } });
}

function cancelRun(): void {
  if (!state.run || state.run.status !== "running") return;
  state.run.status = "cancelled";
  state.run.current = null;
  stopSolver();
  render();
}

// Rendering

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
  el("p", "muted", `${count(t.rows)} ${t.rows === 1 ? "respondent" : "respondents"}, ${t.cols} ${t.cols === 1 ? "product" : "products"}, ${kind}.`, ui.dataInfo);
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
      ? ` First column (${t.idColumn === "" ? "no name" : `"${t.idColumn}"`}) is a respondent ID`
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
    ui.sizeHint.textContent = state.fixed.length
      ? `${k} products, the fixed ones included, reach every respondent that any product reaches.`
      : `${k} ${k === 1 ? "product reaches" : "products reach"} every respondent that any product reaches.`;
  } else {
    ui.sizeHint.textContent = "Finding the smallest full cover…";
  }

  renderFixed();

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
    el("p", "headline-products", list(marked(p.products, run)), head);
    const stats = el("dl", "stats", undefined, head);
    const stat = (label: string, value: string, note: string) => {
      const d = el("div", "stat", undefined, stats);
      el("dt", undefined, label, d);
      el("dd", "stat-value", value, d);
      el("dd", "stat-note", note, d);
    };
    stat("Reach", percent(p.reachProp), `${count(p.reach)} of ${count(p.respondents)} respondents`);
    stat("Frequency", count(p.frequency), `${decimal(p.frequency / p.respondents)} products per respondent`);
    stat("Penetration", decimal(p.penetration), "Harmonic mean of product reach");
    if (p.reach === run.summary.reachable) {
      el("p", "muted", "This portfolio reaches every respondent that any product reaches.", head);
    }
  }
  if (run.status === "error" && run.message) el("p", "error", run.message, head);

  // The reach chart and the stages side by side on a wide screen.
  const split = el("div", "split", undefined, host);
  const curveSection = el("section", "panel-block", undefined, split);
  const curveHead = el("div", "block-head", undefined, curveSection);
  const curveTitle = el("div", "block-title", undefined, curveHead);
  el("h3", undefined, "Reach by portfolio size", curveTitle);
  el("p", "muted", state.chartMode === "line" ? "Select a point or a row to show that portfolio."
    : "Each product keeps one color. A segment is the reach it adds.", curveTitle);
  curveHead.append(segmented("Chart type", [["line", "Line"], ["columns", "Columns"]], state.chartMode, (v) => {
    state.chartMode = v as typeof state.chartMode;
    const arrowKey = document.activeElement instanceof HTMLElement && document.activeElement.closest(".segmented");
    render();
    // Arrow keys move the focus with the choice.
    if (arrowKey) (ui.results.querySelector(`.segmented [data-value="${v}"]`) as HTMLElement | null)?.focus();
  }));
  const curve = el("div", "chart", undefined, curveSection);
  const matrix = { rows: run.respondents, cols: run.cols, data: run.reach, names: run.names };
  const stacks = stackColumns(matrix, done.map((s) => run.results.get(s)!.portfolio), run.fixed);
  const columns: Column[] = done.map((s, k) => ({
    size: s, reach: run.results.get(s)!.portfolio.reach,
    parts: stacks.columns[k].map((part) => ({
      name: part.fixed ? `${part.products.length} fixed products`
        : part.products.length === 1 ? marked(part.products, run)[0] : `${part.products.length} other products`,
      names: part.fixed ? part.products.map((j) => run.names[j]) : marked(part.products, run),
      added: part.added, slot: part.slot, fixed: part.fixed,
    })),
  }));
  const draw = state.chartMode === "line"
    ? () => reachCurve(curve, {
        sizes: run.sizes,
        points: done.map((s) => {
          const p = run.results.get(s)!.portfolio;
          return { size: s, reach: p.reach, reachProp: p.reachProp, names: marked(p.products, run) };
        }),
        respondents: run.respondents,
        reachable: run.summary.reachable / run.respondents,
        selected: shown,
        onSelect: select,
      })
    : () => reachColumns(curve, {
        sizes: run.sizes, columns, respondents: run.respondents,
        reachable: run.summary.reachable / run.respondents, selected: shown, onSelect: select,
      });
  const draws = [draw];
  if (state.chartMode === "columns" && shown !== null) {
    const key = el("div", "contrib-host", undefined, curveSection);
    el("h4", "contrib-title", `What each of the ${shown} products adds`, key);
    contributionList(el("div", undefined, undefined, key), columns.find((c) => c.size === shown)!, run.respondents);
  }

  if (shown !== null && run.status !== "running") {
    const a = run.analyses.get(shown);
    renderStages(el("section", "panel-block", undefined, split), run, shown, a);
    const fr = renderDeepDive(el("section", "panel-block deep-dive", undefined, host), run, shown, a, stale);
    if (fr) draws.push(fr);
  } else if (run.status === "running") {
    const wait = el("section", "panel-block", undefined, split);
    el("h3", undefined, "How the portfolio was chosen", el("div", "block-head", undefined, wait));
    el("p", "muted", "The stages appear when the run is done.", wait);
  }
  // Draw once both columns of the split row exist, so that the chart gets its final width.
  draw();
  lastDraw = () => draws.forEach((d) => d());

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
    selected: selectedSet, fixed: new Set(run.fixed),
  });
}

/** Product names of a run, with "(fixed)" after each fixed product. */
function marked(products: readonly number[], run: Run): string[] {
  return products.map((j) => (run.fixed.includes(j) ? `${run.names[j]} (fixed)` : run.names[j]));
}

/** A segmented control: radio semantics, one tab stop, arrow keys move and select. */
function segmented(label: string, options: [string, string][], value: string,
                   onChange: (value: string) => void): HTMLElement {
  const group = el("div", "segmented");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", label);
  options.forEach(([v, text], k) => {
    const b = el("button", "segmented-option", text, group);
    b.type = "button";
    b.dataset.value = v;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(v === value));
    b.tabIndex = v === value ? 0 : -1;
    b.addEventListener("click", () => { if (v !== value) onChange(v); });
    b.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      onChange(options[(k + step + options.length) % options.length][0]);
    });
  });
  return group;
}

function formatCriterion(c: "reach" | Criterion, value: number, respondents: number): string {
  return c === "reach" ? percent(value / respondents) : c === "frequency" ? count(value) : decimal(value);
}

function portfolios(n: number, atLeast: boolean): string {
  if (atLeast && n <= 1) return "one or more portfolios";
  return `${atLeast ? "at least " : ""}${count(n)} ${n === 1 ? "portfolio" : "portfolios"}`;
}

/** The stages of the optimization, for the portfolio of one size. */
function renderStages(section: HTMLElement, run: Run, size: number, a: Analysis | undefined): void {
  const head = el("div", "block-head", undefined, section);
  const title = el("div", "block-title", undefined, head);
  el("h3", undefined, "How the portfolio was chosen", title);
  const order = ["reach", ...run.tiebreak] as ("reach" | Criterion)[];
  el("p", "muted", (order.length === 1
    ? "One stage: the most reach. Ties on reach are not broken."
    : `${order.length} stages: the most reach, then ${list(order.slice(1).map((c) => CRITERION_LABEL[c].toLowerCase()))} among the portfolios still tied.`) +
    (run.fixed.length ? " Only portfolios with the fixed products count." : ""),
    title);
  const p = run.results.get(size)!.portfolio;
  const ol = el("ol", "stages", undefined, section);
  order.forEach((c, s) => {
    const info = a?.stages?.[s];
    const li = el("li", "stage", undefined, ol);
    const name = el("div", "stage-name", undefined, li);
    el("span", "stage-number", `Stage ${s + 1}`, name);
    el("span", "stage-criterion", s === 0 ? "Most reach" : c === "frequency" ? "Most frequency" : "Best penetration", name);
    const value = c === "reach" ? p.reach : c === "frequency" ? p.frequency : p.penetration;
    el("div", "stage-value", formatCriterion(c, value, run.respondents), li);
    const detail = el("div", "stage-detail", undefined, li);
    if (!info) {
      if (a) el("span", "skeleton", undefined, detail);
      return;
    }
    const tied = info.ties;
    const prev = s > 0 ? a!.stages![s - 1] : null;
    if (s === 0) {
      detail.textContent = tied === 1 && !info.tiesAtLeast
        ? `No other portfolio of ${size} reaches as many respondents.`
        : `${portfolios(tied, info.tiesAtLeast)} of ${size} reach ${percent(p.reachProp)}, the most possible.`.replace(/^./, (m) => m.toUpperCase());
    } else {
      const among = prev!.ties === 1 && !prev!.tiesAtLeast ? "The one portfolio left" : `Among the ${portfolios(prev!.ties, prev!.tiesAtLeast)} left`;
      const range = info.worst === null ? "" : Math.abs(info.worst - value) < 1e-9
        ? `, ${CRITERION_LABEL[c].toLowerCase()} is ${formatCriterion(c, value, run.respondents)} for all of them`
        : `, ${CRITERION_LABEL[c].toLowerCase()} runs from ${formatCriterion(c, info.worst, run.respondents)} to ${formatCriterion(c, value, run.respondents)}`;
      const keep = tied === 1 && !info.tiesAtLeast ? "This stage keeps one." : `This stage keeps ${portfolios(tied, info.tiesAtLeast)}.`;
      detail.textContent = prev!.ties === 1 && !prev!.tiesAtLeast
        ? `${among} decides the choice; this stage does not change it.`
        : `${among}${range}. ${keep}`;
    }
  });
  if (a?.stages) {
    const last = a.stages.at(-1)!;
    if (last.ties > 1 || last.tiesAtLeast) {
      el("p", "hint", `${portfolios(last.ties, last.tiesAtLeast)} tie on ${order.length === 1 ? "reach" : "every stage"}. The solver keeps the first one it finds.`.replace(/^./, (m) => m.toUpperCase()), section);
    }
  }
  if (!a) el("p", "hint", "A deep dive counts the portfolios tied at each stage.", section);
  if (a?.stagesStop && a.stagesStop !== "complete" && a.stagesStop !== "cancelled") {
    el("p", "hint", a.stagesStop === "time"
      ? `The count of tied portfolios stopped after ${ANALYSIS_SECONDS.stages} seconds, so the counts are lower bounds.`
      : "The solver returned an invalid solution, so the counts may be incomplete.", section);
  }
  if (a?.status === "error") el("p", "error", a.message ?? "The analysis stopped with an error.", section);
}

/**
 * The deep dive into the portfolio of one size, run on request: the most
 * popular and the greedy choices against the optimum, and the reach and
 * frequency trade-off as a chart and a table.
 */
function renderDeepDive(section: HTMLElement, run: Run, size: number, a: Analysis | undefined,
                        stale: boolean): (() => void) | null {
  const head = el("div", "block-head", undefined, section);
  const title = el("div", "block-title", undefined, head);
  el("h3", undefined, `Deep dive for ${size} ${size === 1 ? "product" : "products"}`, title);
  if (!a) {
    el("p", "muted", "Compare this portfolio with the most popular products and with the greedy choice, " +
       "and find the trade-off between reach and frequency. This runs more solves.", title);
    if (stale) {
      el("p", "muted", "Run again with the current settings to start a deep dive.", section);
      return null;
    }
    const start = el("button", "button-secondary", "Start deep dive", head);
    start.type = "button";
    start.disabled = state.solver !== "ready";
    start.addEventListener("click", () => {
      requestAnalysis(run, size);
      render();
    });
    return null;
  }
  const p = run.results.get(size)!.portfolio;
  renderComparison(section, run, size, p, a);

  const sub = el("div", "block-title", undefined, section);
  el("h4", "sub-title", "Reach and frequency trade-off", sub);
  el("p", "muted", (run.fixed.length
    ? "Each point is a portfolio with the fixed products that no other such portfolio beats on both reach and frequency, with the best penetration of those. "
    : "Each point is a portfolio that no other portfolio beats on both reach and frequency, with the best penetration of those. ") +
    "From the left, each step gives up reach for frequency.", sub);
  if (a.points.length === 0) {
    const msg = el("p", "muted", undefined, section);
    if (a.status === "error") { msg.className = "error"; msg.textContent = a.message ?? "The analysis stopped with an error."; }
    else if (a.status === "running") msg.textContent = "Finding the portfolios on the frontier…";
    else msg.textContent = a.frontierStop === "time"
      ? `The search stopped after ${ANALYSIS_SECONDS.frontier} seconds before it found a point.`
      : a.frontierStop === "invalid" ? "The solver returned an invalid solution, so the search stopped."
      : a.stagesStop === "invalid" || a.stagesStop === "limit" ? "The search did not start, because the stage solves stopped."
      : "No point was found.";
    return null;
  }
  const pts = a.points;
  const same = (q: Point, r: { reach: number; frequency: number } | null) =>
    r !== null && q.reach === r.reach && q.frequency === r.frequency;
  const named = (q: Point) => ({ reach: q.reach, frequency: q.frequency, penetration: q.penetration, names: marked(q.products, run) });
  const onFrontier = pts.some((q) => same(q, p));
  const sel = state.frontierSelected !== null && state.frontierSelected < pts.length ? state.frontierSelected : null;
  const chart = el("div", "chart", undefined, section);
  const maxFrequency = a.maxFrequency ?? Math.max(...pts.map((q) => q.frequency));
  const draw = () => frontierChart(chart, {
    points: pts.map(named), maxFrequency, respondents: run.respondents,
    chosen: { reach: p.reach, frequency: p.frequency, penetration: p.penetration, names: marked(p.products, run) },
    chosenOnFrontier: onFrontier, selected: sel, onSelect: selectFrontier,
    mostPopular: a.mostPopular && named(a.mostPopular), greedy: a.greedy && named(a.greedy),
  });
  draw();
  const status = a.status === "running" ? `Finding more points… ${pts.length} so far.`
    : a.frontierStop === "time" ? `The search stopped after ${ANALYSIS_SECONDS.frontier} seconds with ${pts.length} points. The frontier may have more.`
    : a.frontierStop === "limit" ? `The search stopped at ${pts.length} points. The frontier has more.`
    : a.frontierStop === "invalid" ? "The solver returned an invalid solution, so the search stopped."
    : pts.length === 1 ? "One portfolio has both the most reach and the most frequency, so there is no trade-off at this size."
    : !onFrontier ? "The chosen portfolio has the most reach but is not on the frontier: a portfolio with the same reach has more frequency. Choose frequency for stage 2 to get it."
    : "";
  if (status) el("p", a.status === "running" ? "hint live" : "hint", status, section);

  const wrap = el("div", "table-wrap", undefined, section);
  const table = el("table", "results-table frontier-table", undefined, wrap);
  const hr = el("tr", undefined, undefined, el("thead", undefined, undefined, table));
  for (const [text, cls] of [["Reach", "num"], ["Frequency", "num"], ["Penetration", "num"], ["Products", "text"],
                             ["Change from most reach", "text"], ["Same as", "text"]]) {
    el("th", cls, text, hr).scope = "col";
  }
  const tbody = el("tbody", undefined, undefined, table);
  const first = new Set(pts[0].products);
  pts.forEach((q, i) => {
    const tr = el("tr", undefined, undefined, tbody);
    tr.tabIndex = 0;
    tr.dataset.index = String(i);
    if (i === sel) { tr.className = "is-selected"; tr.setAttribute("aria-current", "true"); }
    const reach = el("td", "num", undefined, tr);
    reach.append(percent(q.reach / run.respondents), " ");
    el("span", "sub", `(${count(q.reach)})`, reach);
    el("td", "num", count(q.frequency), tr);
    el("td", "num", decimal(q.penetration), tr);
    el("td", "text products", marked(q.products, run).join(", "), tr);
    const now = new Set(q.products);
    const out = pts[0].products.filter((j) => !now.has(j)).map((j) => run.names[j]);
    const inn = q.products.filter((j) => !first.has(j)).map((j) => run.names[j]);
    el("td", "text muted", i === 0 ? "Most reach" : `Swaps ${list(out)} for ${list(inn)}`, tr);
    // Reach and frequency only: the simple choices may have another penetration.
    const notes = [same(q, a.mostPopular) ? "Most popular" : "", same(q, a.greedy) ? "Greedy" : ""].filter(Boolean);
    el("td", "text muted", notes.join(", "), tr);
    tr.addEventListener("click", () => selectFrontier(i));
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectFrontier(i); }
    });
  });
  return draw;
}

/** The gain of the optimum over the most popular products and over the greedy choice. */
function renderComparison(section: HTMLElement, run: Run, size: number, p: Portfolio, a: Analysis): void {
  const block = el("div", "comparison", undefined, section);
  const n = run.respondents;
  const free = size - run.fixed.length;
  if (free === 0) {
    el("p", undefined, "Every product of this portfolio is fixed, so there is no choice to compare.", block);
    return;
  }
  const reachOf = (q: Point) => `${percent(q.reach / n)} (${count(q.reach)})`;
  const gain = (q: Point) => `This portfolio reaches ${count(p.reach - q.reach)} more ${p.reach - q.reach === 1 ? "respondent" : "respondents"}, ${points((p.reach - q.reach) / n)}.`;
  const popular = run.fixed.length
    ? `The fixed products and the ${free === 1 ? "most popular other product" : `${free} most popular other products`}`
    : `The ${size === 1 ? "most popular product" : `${size} most popular products`}`;
  const one = !run.fixed.length && size === 1;
  const mp = a.mostPopular;
  if (mp) {
    el("p", undefined, mp.reach === p.reach
      ? `${popular} already ${one ? "reaches" : "reach"} the most possible, ${reachOf(mp)}.`
      : `${popular} ${one ? "reaches" : "reach"} ${reachOf(mp)}. ${gain(mp)} ` +
        `${popular} ${one ? "has" : "have"} ${count(mp.frequency - p.frequency)} more frequency.`, block);
  } else if (a.baselinesStop === "time") {
    el("p", "muted", `The solve for ${popular.toLowerCase()} stopped after ${ANALYSIS_SECONDS.baselines} seconds.`, block);
  } else if (a.baselinesStop === "invalid") {
    el("p", "muted", "The solver returned an invalid solution for the most popular products.", block);
  } else if (a.status === "running") {
    el("p", "muted", "Comparing with the most popular products…", block);
  }
  const g = a.greedy;
  if (g) {
    el("p", undefined, g.reach === p.reach
      ? "Greedy also reaches the most possible. Greedy adds the product that adds the most reach, one at a time."
      : `Greedy reaches ${reachOf(g)}. Greedy adds the product that adds the most reach, one at a time. ${gain(g)}`, block);
  }
}

/** Select a point of the frontier; select it again to clear. */
function selectFrontier(index: number): void {
  state.frontierSelected = state.frontierSelected === index ? null : index;
  render();
}

let lastDraw: (() => void) | null = null;

function renderTable(host: HTMLElement, run: Run, shown: number | null): void {
  const table = el("table", "results-table size-table", undefined, host);
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
    tr.dataset.size = String(s);
    if (s === shown) tr.className = "is-selected";
    if (s === shown) tr.setAttribute("aria-current", "true");
    el("td", "num", String(s), tr);
    const reach = el("td", "num", undefined, tr);
    reach.append(percent(p.reachProp), " ");
    el("span", "sub", `(${count(p.reach)})`, reach);
    el("td", "num", prev ? points(p.reachProp - prev.reachProp).replace(" points", "") : "", tr);
    el("td", "num", count(p.frequency), tr);
    el("td", "num", decimal(p.penetration), tr);
    el("td", "text products", marked(p.products, run).join(", "), tr);
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
    fixed: new Set(state.fixed),
  });
}

// Fixed products. The list is built when the data or the threshold changes
// and updated in place on each render, so that its focus and filter survive
// the solver's replies.

let fixedItems: { label: HTMLLabelElement; box: HTMLInputElement; name: string }[] = [];
const fixedSortButtons: Record<"name" | "reach", HTMLButtonElement | null> = { name: null, reach: null };

function buildFixedList(): void {
  ui.fixedList.replaceChildren();
  fixedItems = [];
  const l = state.loaded;
  const summary = state.summary;
  ui.fixedFilter.hidden = !l || l.table.cols < FIXED_FILTER_FROM;
  if (!l || !summary) return;
  const head = el("div", "fixed-head", undefined, ui.fixedList);
  for (const [key, text] of [["name", "Product"], ["reach", "Reach"]] as const) {
    const b = el("button", "fixed-sort", text, head);
    b.type = "button";
    b.dataset.sort = key;
    b.addEventListener("click", () => {
      const now = state.fixedSort;
      // A first click sorts names A to Z and reach high to low; the next click reverses.
      state.fixedSort = { key, desc: now?.key === key ? !now.desc : key === "reach" };
      sortFixed();
    });
    fixedSortButtons[key] = b;
  }
  l.table.names.forEach((name, j) => {
    const label = el("label", "fixed-item", undefined, ui.fixedList);
    const box = el("input", undefined, undefined, label);
    box.type = "checkbox";
    box.value = String(j);
    el("span", "fixed-name", name, label).title = name;
    el("span", "fixed-reach", percent(summary.productReach[j] / l.table.rows), label);
    box.addEventListener("change", () => {
      setFixed(box.checked ? [...state.fixed, j] : state.fixed.filter((k) => k !== j));
    });
    fixedItems.push({ label, box, name });
  });
  el("p", "muted fixed-none", "No product matches the filter.", ui.fixedList).hidden = true;
  sortFixed();
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Put the list in the chosen order. The items move; fixedItems stays in column order. */
function sortFixed(): void {
  const summary = state.summary;
  const sort = state.fixedSort;
  const order = fixedItems.map((_, j) => j);
  if (sort && summary) {
    const sign = sort.desc ? -1 : 1;
    // Ties keep column order.
    order.sort((a, b) => sign * (sort.key === "name"
      ? byName.compare(fixedItems[a].name, fixedItems[b].name)
      : summary.productReach[a] - summary.productReach[b]) || a - b);
  }
  const empty = ui.fixedList.querySelector(".fixed-none");
  for (const j of order) ui.fixedList.insertBefore(fixedItems[j].label, empty);
  for (const key of ["name", "reach"] as const) {
    const b = fixedSortButtons[key];
    if (!b) continue;
    const active = sort?.key === key;
    b.classList.toggle("is-active", active);
    b.textContent = (key === "name" ? "Product" : "Reach") + (active ? (sort.desc ? " \u2193" : " \u2191") : "");
    b.setAttribute("aria-label", `Sort by ${key === "name" ? "name" : "reach"}` +
      (active ? `, now ${key === "name" ? (sort.desc ? "Z to A" : "A to Z") : (sort.desc ? "high to low" : "low to high")}` : ""));
  }
}

function renderFixed(): void {
  const summary = state.summary;
  const q = ui.fixedFilter.value.trim().toLowerCase();
  let shown = 0;
  fixedItems.forEach(({ label, box, name }, j) => {
    const none = !summary || summary.productReach[j] === 0;
    box.checked = state.fixed.includes(j);
    box.disabled = none;
    label.classList.toggle("is-disabled", none);
    label.title = none ? "Reaches no respondent at this threshold" : "";
    // A checked product stays in view, so the filter never hides what is fixed.
    label.hidden = q !== "" && !box.checked && !name.toLowerCase().includes(q);
    if (!label.hidden) shown++;
  });
  const empty = ui.fixedList.querySelector<HTMLElement>(".fixed-none");
  if (empty) empty.hidden = shown > 0;
  const f = state.fixed.length;
  ui.fixedHint.textContent = (state.fixedNote ? `${state.fixedNote} ` : "") + (f === 0
    ? "Check the products that every portfolio must contain. The sizes count them."
    : `${f} fixed: every portfolio contains ${f === 1 ? "it" : "them"}, and the sizes count ${f === 1 ? "it" : "them"}.`);
  ui.fixedClear.hidden = f === 0;
}

// A run in progress goes on: it keeps its own fixed products, the cover request
// waits behind it in the solver queue, and the finished run shows as stale.
function setFixed(fixed: number[]): void {
  cancelAnalyses();
  state.fixed = [...new Set(fixed)].sort((a, b) => a - b);
  state.fixedNote = null;
  if (!state.sizesTouched) {
    const from = Math.max(1, state.fixed.length);
    ui.sizeFrom.value = String(from);
    if (!(Number(ui.sizeTo.value) >= from)) ui.sizeTo.value = String(from);
  }
  state.cover = null;
  state.coverError = null;
  requestCover();
  render();
}

/** Show the portfolio of one size. */
function select(size: number): void {
  if (state.selected !== size) state.frontierSelected = null;
  state.selected = size;
  render();
}

/**
 * A selector for the focused element of the results, so that focus survives a
 * render: each render builds the results again, and replies of the solver
 * render at any time.
 */
function focusSelector(): string | null {
  const f = document.activeElement;
  if (!(f instanceof Element) || !ui.results.contains(f)) return null;
  const plot = f.closest("svg")?.classList;
  if (f.classList.contains("hit") && plot) {
    const name = ["curve", "columns", "frontier"].find((c) => plot.contains(c));
    const key = f.hasAttribute("data-size") ? "data-size" : "data-index";
    return name ? `.${name} .hit[${key}="${f.getAttribute(key)}"]` : null;
  }
  if (f instanceof HTMLTableRowElement) {
    return f.dataset.size ? `.size-table tr[data-size="${f.dataset.size}"]` : `.frontier-table tr[data-index="${f.dataset.index}"]`;
  }
  if (f instanceof HTMLElement && f.dataset.value) return `.segmented [data-value="${f.dataset.value}"]`;
  if (f instanceof HTMLElement && f.dataset.product) return `.bar-row[data-product="${f.dataset.product}"]`;
  if (f.classList.contains("button-secondary")) return ".button-secondary";
  return null;
}

function render(): void {
  const focus = focusSelector();
  renderStatus();
  renderExamples();
  renderSettings();
  renderResults();
  restoreFocus(focus);
}

function restoreFocus(selector: string | null): void {
  // Without preventScroll, a reply that renders would scroll back to the focused element.
  if (selector) (ui.results.querySelector(selector) as HTMLElement | SVGElement | null)?.focus({ preventScroll: true });
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
  const focus = focusSelector();
  lastDraw?.();
  restoreFocus(focus);
}).observe(ui.results);

// Events

// Stage 2 and stage 3 make the tie-break. Stage 3 offers the criterion that stage 2 leaves.
function renderStageOptions(): void {
  const [second, third] = state.tiebreak;
  ui.stage2.value = second ?? "none";
  ui.stage3.replaceChildren();
  const other = second === "frequency" ? "penetration" : second === "penetration" ? "frequency" : null;
  if (other) el("option", undefined, CRITERION_LABEL[other], ui.stage3).value = other;
  el("option", undefined, "None", ui.stage3).value = "none";
  ui.stage3.value = third ?? "none";
  ui.stage3.disabled = !other;
}
for (const [v, text] of [["frequency", "Frequency"], ["penetration", "Penetration"], ["none", "None"]]) {
  el("option", undefined, text, ui.stage2).value = v;
}
renderStageOptions();

ui.thresholdInput.addEventListener("change", () => {
  const input = ui.thresholdInput;
  const v = Number(input.value);
  if (input.value.trim() === "" || !Number.isFinite(v)) { input.value = String(state.threshold); return; }
  if (v !== state.threshold) setThreshold(v);
});
const otherCriterion = (c: Criterion): Criterion => (c === "frequency" ? "penetration" : "frequency");
function setTiebreak(tiebreak: Criterion[]): void {
  if (state.run?.status === "running") cancelRun();
  cancelAnalyses();
  state.tiebreak = tiebreak;
  renderStageOptions();
  render();
}
ui.stage2.addEventListener("change", () => {
  const second = ui.stage2.value as Criterion | "none";
  // Keep a third stage when there was one.
  setTiebreak(second === "none" ? [] : state.tiebreak.length === 2 ? [second, otherCriterion(second)] : [second]);
});
ui.stage3.addEventListener("change", () => {
  const second = state.tiebreak[0];
  if (second) setTiebreak(ui.stage3.value === "none" ? [second] : [second, ui.stage3.value as Criterion]);
});

ui.fixedFilter.addEventListener("input", renderFixed);
ui.fixedClear.addEventListener("click", () => setFixed([]));

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

// Theme: light by default; the button switches, and the choice is kept in this browser.
const themeButton = $<HTMLButtonElement>("theme");
function showTheme(): void {
  const dark = document.documentElement.dataset.theme === "dark";
  themeButton.textContent = dark ? "Light mode" : "Dark mode";
  themeButton.setAttribute("aria-pressed", String(dark));
}
themeButton.addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  if (dark) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem("turflp-theme", dark ? "dark" : "light"); } catch { /* storage may be off */ }
  showTheme();
});
showTheme();

buildExamples();
render();
void startSolver();
