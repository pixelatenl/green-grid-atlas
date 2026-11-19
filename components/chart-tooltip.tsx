"use client";

/*
  The ONE shared chart tooltip island for the whole site; the rhythm
  grids (via rhythm-tooltip.tsx) and every SVG/HTML chart below migrate
  onto it, so no private tooltip duplicate remains.

  The charts themselves are server-rendered pure SVG/HTML. This island
  only reads trigger attributes on hover, focus and tap, and positions
  an absolutely-positioned overlay.

  Trigger contract (all attributes are rendered server-side):
  - Attribute mode (the rhythm grids): an element carrying
    data-tip-heading (plus optional data-tip-title, data-tip-value,
    data-tip-qualifier) renders those strings verbatim. With the
    `cursor` prop the overlay follows the cursor exactly, which is the
    approved rhythm-grid placement.
  - Series mode (all other charts): a chart root element carries
    data-tip-root, data-units (the root's width in local units: the
    viewBox width for SVG, the datum count for HTML bands) and optional
    data-x0/data-x1 (the hoverable x range in local units),
    data-tip-series (comma-separated indices into the `series` prop
    shown in the tip) and data-tip-qualifier (a line shown in every tip
    of this root). Inside the root, every datum element carries
    data-tip (its index into `labels`) and data-cx (its center x in root
    units); the visual element additionally carries data-tip-visual and
    is the one marked active on touch. The overlay snaps to the nearest
    datum by x.

  Payload: the island receives compact arrays only (labels as strings,
  values as numbers with 0 or 1 decimals, null for missing data), never
  preformatted sentences, so the serialized client payload stays small.

  Behaviour and family rules honoured here:
  - the overlay is absolutely positioned and pointer-events-none, so
    it never changes layout (nothing grows, moves or reflows on hover,
    focus or tap); emphasis on the active datum is stroke/outline only;
  - it is aria-hidden and not focusable, so hover surfaces never steal
    keyboard focus; the per-element aria-labels remain the screen-reader
    channel, the tooltip is visual only;
  - it is positioned offscreen until first placement, and flips near the
    viewport/container edges (same flip math the rhythm tooltip used);
  - keyboard: focus-visible on a focusable chart element shows the tip
    anchored to that element;
  - touch: a tap snaps the tip to the tapped datum and marks the nearest
    visual element active; a tap on another datum in the same chart
    moves it; a tap outside the chart or any scroll dismisses it. Wide
    invisible hit strips (class chart-hit, one per bar or day, full
    chart height) make taps forgiving, and the container carries
    touch-action: pan-y (class chart-pannable) so a touch-drag still
    scrolls the page normally.
*/

import { useEffect, useRef, useState } from "react";

export interface ChartSeriesDef {
  /** Line label shown before the value, e.g. "Gas-fired production". */
  name: string;
  /** Unit appended to the value, e.g. "MW". */
  unit: string;
  /** Fraction digits of the value (0 or 1 keeps the payload compact). */
  decimals: number;
  /** One value per datum; null renders as an honest "no data". */
  values: (number | null)[];
}

interface Tip {
  source: "mouse" | "touch" | "focus";
  /** Attribute-mode strings (rendered verbatim). */
  heading: string;
  title: string;
  value: string;
  qualifier: string;
  /** Series-mode value lines. */
  lines: { label: string; value: string }[];
  /** Series-mode per-datum note line (band membership etc.). */
  note: string;
  /** True for attribute mode (rhythm grids). */
  attrs: boolean;
  x: number;
  y: number;
}

interface ChartTooltipProps {
  /** One heading per datum (hour, date, year), shared by all roots. */
  labels?: string[];
  /** Value series; each root selects the ones its tips show. */
  series?: ChartSeriesDef[];
  /** Optional per-datum note line, indexed like labels. */
  notes?: (string | null)[];
  /** Cursor-following attribute mode (rhythm grids). */
  cursor?: boolean;
  /** touch-action: pan-y on the container (default true). The rhythm
      island passes false so its horizontally scrollable grids keep
      pan-x on touch. */
  pan?: boolean;
  children: React.ReactNode;
}

const fmt = (v: number, decimals: number) =>
  v.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export function ChartTooltip({ labels = [], series = [], notes = [], cursor = false, pan = true, children }: ChartTooltipProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  /* Mirror of the tip state for the document-level listeners. */
  const tipStateRef = useRef<Tip | null>(null);
  const activeRef = useRef<Element | null>(null);
  const lastTouchRef = useRef(0);
  /* Strip lists per chart root, cached (the data-cx values are static). */
  const stripsRef = useRef(new WeakMap<Element, { el: Element; cx: number }[]>());

  const clearActive = () => {
    activeRef.current?.classList.remove("chart-tip-active");
    activeRef.current = null;
  };

  const applyTip = (t: Tip | null) => {
    tipStateRef.current = t;
    setTip(t);
    if (!t) clearActive();
  };

  const markActive = (el: Element) => {
    const root = el.closest("[data-tip-root]");
    const idx = (el as HTMLElement).dataset?.tip;
    const visual =
      (el.hasAttribute("data-tip-visual") ? el : null) ??
      (root && idx != null ? root.querySelector(`[data-tip-visual][data-tip="${idx}"]`) : null) ??
      el;
    if (activeRef.current === visual) return;
    clearActive();
    visual.classList.add("chart-tip-active");
    activeRef.current = visual;
  };

  const buildSeriesTip = (el: Element, x: number, y: number, source: Tip["source"]): Tip | null => {
    const root = el.closest("[data-tip-root]");
    const idxAttr = (el as HTMLElement).dataset?.tip;
    if (!root || idxAttr == null) return null;
    const i = parseInt(idxAttr, 10);
    if (!Number.isFinite(i) || i < 0 || i >= labels.length) return null;
    const seriesIdx = (root.getAttribute("data-tip-series") ?? "0")
      .split(",")
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && series[n]);
    const lines = seriesIdx.map((si) => {
      const s = series[si];
      const v = s.values[i];
      const ok = typeof v === "number" && Number.isFinite(v);
      return { label: s.name, value: ok ? `${fmt(v, s.decimals)}${s.unit ? ` ${s.unit}` : ""}` : "no data" };
    });
    return {
      source,
      heading: labels[i] ?? "",
      title: "",
      value: "",
      qualifier: root.getAttribute("data-tip-qualifier") ?? "",
      lines,
      note: notes[i] ?? "",
      attrs: false,
      x,
      y,
    };
  };

  const buildTip = (el: Element, x: number, y: number, source: Tip["source"]): Tip | null => {
    const d = (el as HTMLElement).dataset ?? {};
    if (d.tipHeading != null) {
      return {
        source,
        heading: d.tipHeading ?? "",
        title: d.tipTitle ?? "",
        value: d.tipValue ?? "",
        qualifier: d.tipQualifier ?? "",
        lines: [],
        note: "",
        attrs: true,
        x,
        y,
      };
    }
    return buildSeriesTip(el, x, y, source);
  };

  /** Nearest datum strip inside a chart root by pointer x (root units). */
  const findDatum = (root: Element, clientX: number): Element | null => {
    let strips = stripsRef.current.get(root);
    if (!strips) {
      strips = Array.from(root.querySelectorAll("[data-tip]")).map((el) => ({
        el,
        cx: parseFloat((el as HTMLElement).dataset?.cx ?? "0") || 0,
      }));
      stripsRef.current.set(root, strips);
    }
    if (!strips.length) return null;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const units = parseFloat(root.getAttribute("data-units") ?? "1") || 1;
    const xu = ((clientX - rect.left) / rect.width) * units;
    const x0 = root.getAttribute("data-x0");
    const x1 = root.getAttribute("data-x1");
    if (x0 != null && xu < parseFloat(x0)) return null;
    if (x1 != null && xu > parseFloat(x1)) return null;
    let best: Element | null = null;
    let bestD = Infinity;
    for (const s of strips) {
      const d = Math.abs(s.cx - xu);
      if (d < bestD) {
        bestD = d;
        best = s.el;
      }
    }
    return best;
  };

  /** Snapped x of a datum element, in container coordinates. */
  const snappedX = (root: Element, el: Element, boxRect: DOMRect): number => {
    const rect = root.getBoundingClientRect();
    const units = parseFloat(root.getAttribute("data-units") ?? "1") || 1;
    const cx = parseFloat((el as HTMLElement).dataset?.cx ?? "0") || 0;
    return rect.left + (cx / units) * rect.width - boxRect.left;
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() - lastTouchRef.current < 600) return; // ignore compat mouse events after a tap
    const box = boxRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const target = e.target as Element;
    if (cursor) {
      const cell = target.closest?.("[data-tip-heading]");
      if (!cell) {
        applyTip(null);
        return;
      }
      const t = buildTip(cell, e.clientX - r.left, e.clientY - r.top, "mouse");
      if (t) applyTip(t);
      return;
    }
    const root = target.closest?.("[data-tip-root]");
    if (!root) {
      applyTip(null);
      return;
    }
    const el = findDatum(root, e.clientX);
    if (!el) {
      applyTip(null);
      return;
    }
    const t = buildSeriesTip(el, snappedX(root, el, r), e.clientY - r.top, "mouse");
    if (t) applyTip(t);
  };

  const onFocusCapture = (e: React.FocusEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    const el = target.closest?.("[data-tip],[data-tip-heading]");
    if (!el || !(el as HTMLElement).matches?.(":focus-visible")) return;
    const box = boxRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const t = buildTip(el, er.left + er.width / 2 - r.left, er.top + er.height / 2 - r.top, "focus");
    if (t) applyTip(t);
  };

  const onBlurCapture = () => {
    if (tipStateRef.current?.source === "focus") applyTip(null);
  };

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    lastTouchRef.current = Date.now();
    const box = boxRef.current;
    if (!box) return;
    const touch = e.touches[0];
    const r = box.getBoundingClientRect();
    const target = e.target as Element;
    let el: Element | null = null;
    let x = touch.clientX - r.left;
    if (cursor) {
      el = target.closest?.("[data-tip-heading]");
    } else {
      const root = target.closest?.("[data-tip-root]");
      if (root) {
        el = findDatum(root, touch.clientX);
        if (el) x = snappedX(root, el, r);
      }
    }
    if (!el) {
      if (tipStateRef.current?.source === "touch") applyTip(null);
      return;
    }
    const t = buildTip(el, x, touch.clientY - r.top, "touch");
    if (t) {
      applyTip(t);
      markActive(el);
    }
  };

  /* Position after render (offscreen until placed, so nothing flashes).
     Same flip math as the approved rhythm tooltip: near the right edge
     the overlay flips to the left of the anchor, near the top it flips
     below, and it is always clamped inside the container. */
  useEffect(() => {
    const box = boxRef.current;
    const el = tipRef.current;
    if (!box || !el || !tip) return;
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let left = tip.x + 14;
    if (left + tw > bw - 4) left = tip.x - tw - 14; // edge flip near the right margin
    left = Math.max(4, Math.min(left, bw - tw - 4));
    let top = tip.y - th - 10;
    if (top < 0) top = tip.y + 16;
    top = Math.max(4, Math.min(top, bh - th - 4));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [tip]);

  /* Touch dismissal: a tap outside this chart, or any scroll, hides a
     touch-activated tip. Passive listeners: scrolling is never blocked. */
  useEffect(() => {
    const onDocTouchStart = (e: TouchEvent) => {
      const cur = tipStateRef.current;
      if (cur?.source !== "touch") return;
      const box = boxRef.current;
      if (box && e.target instanceof Node && !box.contains(e.target)) applyTip(null);
    };
    const onDocScroll = () => {
      if (tipStateRef.current?.source === "touch") applyTip(null);
    };
    document.addEventListener("touchstart", onDocTouchStart, { capture: true, passive: true });
    document.addEventListener("scroll", onDocScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("touchstart", onDocTouchStart, { capture: true } as EventListenerOptions);
      document.removeEventListener("scroll", onDocScroll, { capture: true } as EventListenerOptions);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Unmount cleanup for the active marker. */
  useEffect(() => () => clearActive(), []);

  return (
    <div
      ref={boxRef}
      data-chart-tip-island
      className={`relative${pan ? " chart-pannable" : ""}`}
      onMouseMove={onMouseMove}
      onMouseLeave={() => applyTip(null)}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
      onTouchStart={onTouchStart}
    >
      {children}
      <div
        ref={tipRef}
        aria-hidden="true"
        className="pointer-events-none absolute z-20 w-60 rounded-lg border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg"
        style={{ left: -9999, top: 0, visibility: tip ? "visible" : "hidden" }}
      >
        {tip && tip.attrs && (
          <>
            <p className="font-semibold">{tip.heading}</p>
            {tip.title && <p className="text-muted-foreground">{tip.title}</p>}
            <p className="mt-0.5">
              <span className="font-medium tabular-nums">{tip.value}</span>
            </p>
            {tip.qualifier && <p className="text-muted-foreground">{tip.qualifier}</p>}
          </>
        )}
        {tip && !tip.attrs && (
          <>
            <p className="font-semibold">{tip.heading}</p>
            {tip.lines.map((l, i) => (
              <p key={i} className={i === 0 ? "mt-0.5" : ""}>
                <span className="text-muted-foreground">{l.label}: </span>
                <span className="font-medium tabular-nums">{l.value}</span>
              </p>
            ))}
            {tip.note && <p className="mt-0.5 text-muted-foreground">{tip.note}</p>}
            {tip.qualifier && <p className="text-muted-foreground">{tip.qualifier}</p>}
          </>
        )}
      </div>
    </div>
  );
}
