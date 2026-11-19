"use client";

/*
  The single cursor-following tooltip overlay shared by all five rhythm
  grids in the atlas card. The grids themselves are server-rendered pure
  SVG; each cell carries its own data-* attributes, and this island only
  reads them on hover and positions the overlay.

  Family rules honoured here: the overlay is absolutely positioned and
  pointer-events-none, so it never changes layout (nothing grows on
  hover), it is aria-hidden and not focusable, so hover surfaces never
  steal keyboard focus, and there is no interaction inside the tooltip.
  Near the right margin the overlay flips to the left of the cursor.
*/

import { useEffect, useRef, useState } from "react";

interface Tip {
  month: string;
  hour: string;
  title: string;
  value: string;
  qualifier: string;
  x: number;
  y: number;
}

export function RhythmTooltip({ children }: { children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box) return;
    const cell = (e.target as HTMLElement).closest?.("[data-rhythm-cell]") as HTMLElement | null;
    if (!cell) {
      setTip(null);
      return;
    }
    const r = box.getBoundingClientRect();
    const d = cell.dataset;
    setTip({
      month: d.month ?? "",
      hour: d.hour ?? "",
      title: d.title ?? "",
      value: d.value ?? "",
      qualifier: d.qualifier ?? "",
      x: e.clientX - r.left,
      y: e.clientY - r.top,
    });
  };

  /* Position after render (offscreen until placed, so nothing flashes). */
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

  return (
    <div ref={boxRef} className="relative" onMouseMove={onMouseMove} onMouseLeave={() => setTip(null)}>
      {children}
      <div
        ref={tipRef}
        aria-hidden="true"
        className="pointer-events-none absolute z-20 w-60 rounded-lg border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg"
        style={{ left: -9999, top: 0, visibility: tip ? "visible" : "hidden" }}
      >
        {tip && (
          <>
            <p className="font-semibold">
              {tip.month} · {tip.hour}
            </p>
            <p className="text-muted-foreground">{tip.title}</p>
            <p className="mt-0.5">
              <span className="font-medium tabular-nums">{tip.value}</span>
            </p>
            <p className="text-muted-foreground">{tip.qualifier}</p>
          </>
        )}
      </div>
    </div>
  );
}
