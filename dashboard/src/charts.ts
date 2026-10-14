// The charts of the page: reach by size as a line or as columns of each
// product's contribution, the reach and frequency trade-off, and the reach of
// each product. One shared tooltip per chart. Colors come from CSS custom
// properties, so both themes work.

import { count, decimal, list, percent, points } from "./format.js";

const SVG = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>,
                                                   parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

function html<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string,
                                                     parent?: Element): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  parent?.appendChild(el);
  return el;
}

function text(parent: Element, x: number, y: number, cls: string, value: string,
              anchor: "start" | "middle" | "end" = "middle", baseline?: string): SVGTextElement {
  const t = svg("text", { x, y, class: cls, "text-anchor": anchor, ...(baseline ? { "dominant-baseline": baseline } : {}) }, parent);
  t.textContent = value;
  return t;
}

const products = (k: number) => `${k} ${k === 1 ? "product" : "products"}`;

type TipLine = { text: string; strong?: boolean; muted?: boolean };

/** One tooltip, placed next to the mark under the pointer and kept inside its host. */
export class Tooltip {
  readonly el: HTMLDivElement;
  constructor(private host: HTMLElement) {
    this.el = html("div", "tooltip");
    this.el.setAttribute("role", "status");
    this.el.hidden = true;
    host.appendChild(this.el);
  }

  show(lines: TipLine[], x: number, y: number): void {
    this.el.replaceChildren(...lines.map((l) =>
      html("div", l.strong ? "tip-strong" : l.muted ? "tip-muted" : "", l.text)));
    this.el.hidden = false;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const maxX = this.host.clientWidth - w - 4;
    let left = x + 12;
    if (left > maxX) left = x - w - 12;
    let top = y - h - 10;
    if (top < 0) top = y + 14;
    this.el.style.left = `${Math.max(4, left)}px`;
    this.el.style.top = `${top}px`;
  }

  hide(): void {
    this.el.hidden = true;
  }
}

/** Make a mark a button: pointer and keyboard show the tooltip, click and Enter select. */
function interactive(hit: SVGElement, show: () => void, hide: () => void, select: () => void): void {
  hit.addEventListener("pointerenter", show);
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("focus", show);
  hit.addEventListener("blur", hide);
  hit.addEventListener("click", select);
  hit.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") { e.preventDefault(); select(); }
  });
}

interface Frame {
  root: SVGSVGElement;
  width: number;
  height: number;
  m: { top: number; right: number; bottom: number; left: number };
  iw: number;
  ih: number;
}

function frame(host: HTMLElement, cls: string, label: string, height: number,
               m = { top: 20, right: 16, bottom: 44, left: 48 }): Frame {
  const width = Math.max(280, host.clientWidth);
  const root = svg("svg", {
    width, height, viewBox: `0 0 ${width} ${height}`, class: `plot ${cls}`,
    // A group, not an image: its marks are buttons.
    role: "group", "aria-label": label,
  }, host);
  return { root, width, height, m, iw: width - m.left - m.right, ih: height - m.top - m.bottom };
}

/** Horizontal grid lines with percent labels, from 0 to 100%. */
function percentGrid(f: Frame, y: (prop: number) => number): void {
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    svg("line", { x1: f.m.left, x2: f.width - f.m.right, y1: y(t), y2: y(t), class: t === 0 ? "axis" : "grid" }, f.root);
    text(f.root, f.m.left - 8, y(t), "tick", `${t * 100}%`, "end", "middle");
  }
}

function ceiling(f: Frame, y: (prop: number) => number, reachable: number): void {
  if (reachable >= 0.9995) return;
  svg("line", { x1: f.m.left, x2: f.width - f.m.right, y1: y(reachable), y2: y(reachable), class: "ceiling" }, f.root);
  // Left end: the curve starts low there, so the label stays clear of it.
  text(f.root, f.m.left + 6, y(reachable) - 6, "ceiling-label", `Reachable ${percent(reachable)}`, "start");
}

function sizeTicks(f: Frame, sizes: number[], x: (s: number) => number): void {
  const every = sizes.length > 16 ? Math.ceil(sizes.length / 12) : 1;
  const hi = sizes[sizes.length - 1];
  sizes.forEach((s, k) => {
    if (k % every !== 0 && s !== hi) return;
    text(f.root, x(s), f.height - f.m.bottom + 18, "tick", String(s));
  });
  text(f.root, f.m.left + f.iw / 2, f.height - 6, "axis-title", "Products in the portfolio");
}

export interface CurvePoint {
  size: number;
  reach: number;
  reachProp: number;
  names: readonly string[];
}

export interface CurveOptions {
  /** All sizes of the run, so the axis does not move while results arrive. */
  sizes: number[];
  points: CurvePoint[];
  respondents: number;
  /** Share of respondents that some product reaches. */
  reachable: number;
  selected: number | null;
  onSelect: (size: number) => void;
}

/** Draw the reach curve into `host` (which must be position: relative). */
export function reachCurve(host: HTMLElement, o: CurveOptions): void {
  host.replaceChildren();
  const tooltip = new Tooltip(host);
  const f = frame(host, "curve", "Reach by portfolio size", 280);
  const { m, iw, ih } = f;
  const lo = o.sizes[0];
  const hi = o.sizes[o.sizes.length - 1];
  const step = o.sizes.length > 1 ? iw / (o.sizes.length - 1) : 0;
  const x = (size: number) => m.left + (o.sizes.length > 1 ? ((size - lo) / (hi - lo)) * iw : iw / 2);
  const y = (prop: number) => m.top + (1 - prop) * ih;
  percentGrid(f, y);
  sizeTicks(f, o.sizes, x);
  ceiling(f, y, o.reachable);

  const pts = [...o.points].sort((a, b) => a.size - b.size);
  if (pts.length > 1) {
    const d = pts.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.size).toFixed(1)},${y(p.reachProp).toFixed(1)}`).join("");
    svg("path", { d: `${d}L${x(pts.at(-1)!.size).toFixed(1)},${y(0)}L${x(pts[0].size).toFixed(1)},${y(0)}Z`, class: "curve-area" }, f.root);
    svg("path", { d, class: "curve-line" }, f.root);
  }
  const crosshair = svg("line", { x1: 0, x2: 0, y1: m.top, y2: m.top + ih, class: "crosshair", visibility: "hidden" }, f.root);
  for (const p of pts) {
    const selected = p.size === o.selected;
    svg("circle", { cx: x(p.size), cy: y(p.reachProp), r: selected ? 6 : 4, class: selected ? "dot dot-selected" : "dot" }, f.root);
    if (selected) text(f.root, x(p.size), y(p.reachProp) - 12, "dot-label", percent(p.reachProp));
  }

  // Hit targets: one band per size, wider than the mark.
  const band = Math.max(step, 24);
  const bySize = new Map(pts.map((p) => [p.size, p]));
  for (const s of o.sizes) {
    const p = bySize.get(s);
    if (!p) continue;
    const prev = bySize.get(s - 1);
    const hit = svg("rect", {
      x: x(s) - band / 2, y: m.top - 12, width: band, height: ih + 24, class: "hit",
      tabindex: 0, role: "button", "data-size": s,
      "aria-label": `${products(s)}: reach ${percent(p.reachProp)}. Select to show this portfolio.`,
    }, f.root);
    interactive(hit, () => {
      crosshair.setAttribute("x1", String(x(s)));
      crosshair.setAttribute("x2", String(x(s)));
      crosshair.setAttribute("visibility", "visible");
      const lines: TipLine[] = [
        { text: products(s), strong: true },
        { text: `Reach ${percent(p.reachProp)} (${count(p.reach)} of ${count(o.respondents)})` },
      ];
      if (prev) lines.push({ text: `${points(p.reachProp - prev.reachProp)} over ${products(prev.size)}`, muted: true });
      lines.push({ text: list(p.names), muted: true });
      tooltip.show(lines, x(s), y(p.reachProp));
    }, () => { crosshair.setAttribute("visibility", "hidden"); tooltip.hide(); }, () => o.onSelect(s));
  }
}

export interface Column {
  size: number;
  reach: number;
  /** Products in the order they were counted, with the respondents each adds. */
  parts: { name: string; added: number }[];
}

export interface ColumnsOptions {
  sizes: number[];
  columns: Column[];
  respondents: number;
  reachable: number;
  selected: number | null;
  onSelect: (size: number) => void;
}

/**
 * Color of the k-th of the n products of a column, in the order counted: the
 * first is the strongest step of the ramp and the last the weakest.
 */
export function stepColor(k: number, n: number): string {
  const t = n <= 1 ? 0 : Math.round((100 * k) / (n - 1));
  return `color-mix(in oklch, var(--ramp-end) ${t}%, var(--ramp-start))`;
}

/** Reach by size as columns: each column stacks what each product adds to the reach. */
export function reachColumns(host: HTMLElement, o: ColumnsOptions): void {
  host.replaceChildren();
  const tooltip = new Tooltip(host);
  const f = frame(host, "columns", "Reach by portfolio size, with what each product adds", 280);
  const { m, iw, ih } = f;
  const slot = iw / o.sizes.length;
  const barW = Math.max(6, Math.min(40, slot * 0.62));
  const x = (size: number) => m.left + slot * (o.sizes.indexOf(size) + 0.5);
  const y = (prop: number) => m.top + (1 - prop) * ih;
  percentGrid(f, y);
  sizeTicks(f, o.sizes, x);
  ceiling(f, y, o.reachable);

  for (const c of o.columns) {
    const selected = c.size === o.selected;
    const g = svg("g", { class: `column${o.selected !== null && !selected ? " is-dim" : ""}`, "data-size": c.size }, f.root);
    let below = 0;
    c.parts.forEach((p, k) => {
      const top = below + p.added;
      const y0 = y(below / o.respondents);
      const y1 = y(top / o.respondents);
      // A 2px surface gap between segments; the top segment has a rounded end.
      const gap = k > 0 ? 2 : 0;
      const h = Math.max(0, y0 - y1 - gap);
      if (h > 0) {
        const isTop = k === c.parts.length - 1;
        const r = isTop ? Math.min(4, h, barW / 2) : 0;
        const x0 = x(c.size) - barW / 2;
        const d = r > 0
          ? `M${x0},${y0 - gap}V${y1 + r}Q${x0},${y1} ${x0 + r},${y1}H${x0 + barW - r}Q${x0 + barW},${y1} ${x0 + barW},${y1 + r}V${y0 - gap}Z`
          : `M${x0},${y0 - gap}V${y1}H${x0 + barW}V${y0 - gap}Z`;
        svg("path", { d, class: "segment", style: `fill:${stepColor(k, c.parts.length)}` }, g);
      }
      below = top;
    });
    if (selected) text(f.root, x(c.size), y(c.reach / o.respondents) - 8, "dot-label", percent(c.reach / o.respondents));

    const hit = svg("rect", {
      x: x(c.size) - Math.max(slot, 24) / 2, y: m.top - 12, width: Math.max(slot, 24), height: ih + 24, class: "hit",
      tabindex: 0, role: "button", "data-size": c.size,
      "aria-label": `${products(c.size)}: reach ${percent(c.reach / o.respondents)}. Select to show this portfolio.`,
    }, f.root);
    interactive(hit, () => {
      const lines: TipLine[] = [
        { text: `${products(c.size)}: reach ${percent(c.reach / o.respondents)}`, strong: true },
        ...c.parts.slice(0, 10).map((p, k) => ({
          text: `${k === 0 ? "" : "+ "}${p.name} ${k === 0 ? percent(p.added / o.respondents) : points(p.added / o.respondents).replace(" points", "")}`,
          muted: k > 0,
        })),
      ];
      if (c.parts.length > 10) lines.push({ text: `and ${c.parts.length - 10} more`, muted: true });
      tooltip.show(lines, x(c.size), y(c.reach / o.respondents));
      g.classList.add("is-hover");
    }, () => { tooltip.hide(); g.classList.remove("is-hover"); }, () => o.onSelect(c.size));
  }
}

/** What each product of one portfolio adds, in the order counted: the key of the columns. */
export function contributionList(host: HTMLElement, column: Column, respondents: number): void {
  host.replaceChildren();
  const head = html("div", "contrib-row contrib-head", undefined, host);
  head.setAttribute("aria-hidden", "true");
  for (const t of ["", "Product", "Adds (points)", "Reach so far"]) html("span", undefined, t, head);
  const ol = html("ol", "contrib", undefined, host);
  ol.setAttribute("aria-label", `What each product of the ${column.size}-product portfolio adds to its reach`);
  let total = 0;
  column.parts.forEach((p, k) => {
    total += p.added;
    const li = html("li", "contrib-row", undefined, ol);
    const sw = html("span", "contrib-swatch", undefined, li);
    sw.style.background = stepColor(k, column.parts.length);
    html("span", "contrib-name", p.name, li);
    html("span", "contrib-added", `${k === 0 ? "" : "+"}${(100 * p.added / respondents).toFixed(1)}`, li);
    html("span", "contrib-total", percent(total / respondents), li);
  });
}

export interface FrontierPoint {
  reach: number;
  frequency: number;
  penetration: number;
  names: readonly string[];
}

export interface FrontierOptions {
  points: FrontierPoint[];
  /** The most frequency of any portfolio of this size, so the axis does not move. */
  maxFrequency: number;
  respondents: number;
  /** The portfolio of the run, drawn as its own mark when it is not on the frontier. */
  chosen: FrontierPoint;
  chosenOnFrontier: boolean;
  selected: number | null;
  onSelect: (index: number) => void;
}

function niceStep(span: number, target: number): number {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((s) => s * p).find((s) => s >= raw) ?? 10 * p;
}

/** Reach against frequency for the portfolios on the trade-off frontier of one size. */
export function frontierChart(host: HTMLElement, o: FrontierOptions): void {
  host.replaceChildren();
  const tooltip = new Tooltip(host);
  const f = frame(host, "frontier", "Reach and frequency of the portfolios on the frontier", 280,
                  { top: 24, right: 24, bottom: 44, left: 56 });
  const { m, iw, ih } = f;
  const all = [...o.points, o.chosen];
  const fLo = Math.min(...all.map((p) => p.frequency));
  const fHi = Math.max(o.maxFrequency, ...all.map((p) => p.frequency));
  const rLo = Math.min(...all.map((p) => p.reach)) / o.respondents;
  const rHi = Math.max(...all.map((p) => p.reach)) / o.respondents;
  // Pad both ranges, so that the end points are not on the frame.
  const fPad = Math.max(1, (fHi - fLo) * 0.08);
  const rPad = Math.max(0.005, (rHi - rLo) * 0.12);
  // About one frequency label per 90 pixels, so that the labels do not touch.
  const fStep = niceStep(fHi - fLo + 2 * fPad, Math.max(2, Math.min(6, Math.floor(iw / 90))));
  const rStep = niceStep(rHi - rLo + 2 * rPad, 4);
  const x0 = Math.floor((fLo - fPad) / fStep) * fStep;
  const x1 = Math.ceil((fHi + fPad) / fStep) * fStep;
  const y0 = Math.max(0, Math.floor((rLo - rPad) / rStep) * rStep);
  const y1 = Math.min(1, Math.ceil((rHi + rPad) / rStep) * rStep);
  const x = (v: number) => m.left + ((v - x0) / (x1 - x0)) * iw;
  const y = (prop: number) => m.top + (1 - (prop - y0) / (y1 - y0)) * ih;

  for (let v = y0; v <= y1 + 1e-9; v += rStep) {
    svg("line", { x1: m.left, x2: f.width - m.right, y1: y(v), y2: y(v), class: Math.abs(v - y0) < 1e-9 ? "axis" : "grid" }, f.root);
    text(f.root, m.left - 8, y(v), "tick", `${(100 * v).toFixed(rStep < 0.01 ? 1 : 0)}%`, "end", "middle");
  }
  for (let v = x0; v <= x1 + 1e-9; v += fStep) {
    text(f.root, x(v), f.height - m.bottom + 18, "tick", count(Math.round(v)));
  }
  text(f.root, m.left + iw / 2, f.height - 6, "axis-title", "Frequency");
  svg("line", { x1: m.left, x2: m.left, y1: m.top, y2: m.top + ih, class: "axis" }, f.root);

  const pts = o.points;
  if (pts.length > 1) {
    // Steps down, then right: the edge of what some portfolio reaches. No portfolio is above it.
    let d = `M${x(pts[0].frequency).toFixed(1)},${y(pts[0].reach / o.respondents).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      d += `V${y(pts[i].reach / o.respondents).toFixed(1)}H${x(pts[i].frequency).toFixed(1)}`;
    }
    svg("path", { d, class: "frontier-line" }, f.root);
  }
  pts.forEach((p, i) => {
    const sel = i === o.selected;
    svg("circle", { cx: x(p.frequency), cy: y(p.reach / o.respondents), r: sel ? 6 : 4.5, class: sel ? "dot dot-selected" : "dot" }, f.root);
  });
  if (!o.chosenOnFrontier) {
    const cx = x(o.chosen.frequency);
    const cy = y(o.chosen.reach / o.respondents);
    svg("path", { d: `M${cx},${cy - 7}L${cx + 7},${cy}L${cx},${cy + 7}L${cx - 7},${cy}Z`, class: "chosen-mark" }, f.root);
    text(f.root, cx, cy + 22, "end-label", "Chosen");
  }
  // Label the two ends: the trade-off runs between them.
  if (pts.length) {
    const first = pts[0];
    text(f.root, x(first.frequency) + 10, y(first.reach / o.respondents) - 10, "end-label", "Most reach", "start");
    const last = pts.at(-1)!;
    if (pts.length > 1 && last.frequency >= o.maxFrequency) {
      text(f.root, x(last.frequency) - 10, y(last.reach / o.respondents) + 22, "end-label", "Most frequency", "end");
    }
  }

  const base = pts[0];
  pts.forEach((p, i) => {
    const cx = x(p.frequency);
    const cy = y(p.reach / o.respondents);
    const hit = svg("circle", {
      cx, cy, r: 14, class: "hit", tabindex: 0, role: "button", "data-index": i,
      "aria-label": `Reach ${percent(p.reach / o.respondents)}, frequency ${count(p.frequency)}. Select to show these products.`,
    }, f.root);
    interactive(hit, () => {
      const lines: TipLine[] = [
        { text: `Reach ${percent(p.reach / o.respondents)}, frequency ${count(p.frequency)}`, strong: true },
        { text: `Penetration ${decimal(p.penetration)}` },
      ];
      if (i > 0) {
        lines.push({ text: `${points((p.reach - base.reach) / o.respondents)} reach, +${count(p.frequency - base.frequency)} frequency against most reach`, muted: true });
      }
      lines.push({ text: list(p.names), muted: true });
      tooltip.show(lines, cx, cy);
    }, () => tooltip.hide(), () => o.onSelect(i));
  });
}

export interface BarsOptions {
  names: readonly string[];
  productReach: readonly number[];
  respondents: number;
  /** Column indices of the selected portfolio; null before a run. */
  selected: ReadonlySet<number> | null;
}

/** Individual reach of each product, largest first. */
export function productBars(host: HTMLElement, o: BarsOptions): void {
  host.replaceChildren();
  const tooltip = new Tooltip(host);
  const order = o.names.map((_, j) => j)
    .sort((a, b) => o.productReach[b] - o.productReach[a] || o.names[a].localeCompare(o.names[b]));
  let max = 1;
  for (const r of o.productReach) if (r > max) max = r;
  const listEl = html("div", "bars", undefined, host);
  listEl.setAttribute("role", "list");
  for (const j of order) {
    const inPortfolio = o.selected?.has(j) ?? false;
    const row = html("div", `bar-row${o.selected ? (inPortfolio ? " is-in" : " is-out") : ""}`, undefined, listEl);
    row.setAttribute("role", "listitem");
    row.tabIndex = 0;
    const name = html("span", "bar-name", o.names[j], row);
    name.title = o.names[j];
    const track = html("span", "bar-track", undefined, row);
    const fill = html("span", "bar-fill", undefined, track);
    fill.style.width = `${(100 * o.productReach[j]) / max}%`;
    const prop = o.productReach[j] / o.respondents;
    html("span", "bar-value", percent(prop), row);
    row.setAttribute("aria-label",
      `${o.names[j]}: reaches ${percent(prop)}${inPortfolio ? ", in the portfolio" : ""}`);
    const show = () => {
      const r = row.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      const t = track.getBoundingClientRect();
      tooltip.show([
        { text: o.names[j], strong: true },
        { text: `Reaches ${count(o.productReach[j])} of ${count(o.respondents)} (${percent(prop)})` },
        ...(inPortfolio ? [{ text: "In the selected portfolio", muted: true }] : []),
      ], t.left - h.left + (t.width * o.productReach[j]) / max, r.top - h.top);
    };
    row.addEventListener("pointerenter", show);
    row.addEventListener("pointerleave", () => tooltip.hide());
    row.addEventListener("focus", show);
    row.addEventListener("blur", () => tooltip.hide());
  }
}
