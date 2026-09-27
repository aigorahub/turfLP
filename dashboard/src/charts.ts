// The reach curve (SVG) and the product reach bars (HTML), with one shared
// tooltip. Colors come from CSS custom properties, so both themes work.

import { count, list, percent, points } from "./format.js";

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
  const width = Math.max(280, host.clientWidth);
  const height = 260;
  const m = { top: 20, right: 16, bottom: 44, left: 48 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const root = svg("svg", {
    width, height, viewBox: `0 0 ${width} ${height}`, class: "curve",
    role: "img", "aria-label": "Reach by portfolio size",
  }, host);

  const lo = o.sizes[0];
  const hi = o.sizes[o.sizes.length - 1];
  const step = o.sizes.length > 1 ? iw / (o.sizes.length - 1) : 0;
  const x = (size: number) => m.left + (o.sizes.length > 1 ? ((size - lo) / (hi - lo)) * iw : iw / 2);
  const y = (prop: number) => m.top + (1 - prop) * ih;

  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    svg("line", { x1: m.left, x2: width - m.right, y1: y(t), y2: y(t), class: t === 0 ? "axis" : "grid" }, root);
    const label = svg("text", { x: m.left - 8, y: y(t), class: "tick", "text-anchor": "end", "dominant-baseline": "middle" }, root);
    label.textContent = `${t * 100}%`;
  }
  const every = o.sizes.length > 16 ? Math.ceil(o.sizes.length / 12) : 1;
  o.sizes.forEach((s, k) => {
    if (k % every !== 0 && s !== hi) return;
    const label = svg("text", { x: x(s), y: height - m.bottom + 18, class: "tick", "text-anchor": "middle" }, root);
    label.textContent = String(s);
  });
  const title = svg("text", { x: m.left + iw / 2, y: height - 6, class: "axis-title", "text-anchor": "middle" }, root);
  title.textContent = "Products in the portfolio";

  if (o.reachable < 0.9995) {
    svg("line", { x1: m.left, x2: width - m.right, y1: y(o.reachable), y2: y(o.reachable), class: "ceiling" }, root);
    // Left end: the curve starts low there, so the label stays clear of it.
    const label = svg("text", { x: m.left + 6, y: y(o.reachable) - 6, class: "ceiling-label", "text-anchor": "start" }, root);
    label.textContent = `Reachable ${percent(o.reachable)}`;
  }

  const pts = [...o.points].sort((a, b) => a.size - b.size);
  if (pts.length > 1) {
    const d = pts.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.size).toFixed(1)},${y(p.reachProp).toFixed(1)}`).join("");
    svg("path", { d, class: "curve-line" }, root);
  }
  const crosshair = svg("line", { x1: 0, x2: 0, y1: m.top, y2: m.top + ih, class: "crosshair", visibility: "hidden" }, root);
  for (const p of pts) {
    const selected = p.size === o.selected;
    svg("circle", { cx: x(p.size), cy: y(p.reachProp), r: selected ? 6 : 4, class: selected ? "dot dot-selected" : "dot" }, root);
    if (selected) {
      const label = svg("text", { x: x(p.size), y: y(p.reachProp) - 12, class: "dot-label", "text-anchor": "middle" }, root);
      label.textContent = percent(p.reachProp);
    }
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
      tabindex: 0, role: "button",
      "aria-label": `${s} products: reach ${percent(p.reachProp)}. Select to show this portfolio.`,
    }, root);
    const show = () => {
      crosshair.setAttribute("x1", String(x(s)));
      crosshair.setAttribute("x2", String(x(s)));
      crosshair.setAttribute("visibility", "visible");
      const lines: TipLine[] = [
        { text: `${s} ${s === 1 ? "product" : "products"}`, strong: true },
        { text: `Reach ${percent(p.reachProp)} (${count(p.reach)} of ${count(o.respondents)})` },
      ];
      if (prev) lines.push({ text: `${points(p.reachProp - prev.reachProp)} over ${prev.size} ${prev.size === 1 ? "product" : "products"}`, muted: true });
      lines.push({ text: list(p.names), muted: true });
      tooltip.show(lines, x(s), y(p.reachProp));
    };
    const hide = () => { crosshair.setAttribute("visibility", "hidden"); tooltip.hide(); };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", show);
    hit.addEventListener("blur", hide);
    hit.addEventListener("click", () => o.onSelect(s));
    hit.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.onSelect(s); }
    });
  }
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
  const max = Math.max(1, ...o.productReach);
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
