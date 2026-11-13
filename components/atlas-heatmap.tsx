"use client";

/*
  The atlas: an hour x day heatmap of the Dutch grid with a layer switcher
  (price, renewable share of generation, computed intensity), a period
  selector (month, season, year, full history via the per-year composites),
  a weather overlay toggle, transition markers outlining the green-window
  and red-hour bands, and a crosshair + tooltip layer.

  DST rule: the column axis is fixed at 25 hour slots. A normal day fills
  24, a 23-hour spring-forward day leaves the 02:00 slot as an explicit gap
  cell, and a 25-hour fall-back day fills both 02:00 slots (labelled 02:00
  +02:00 and 02:00 +01:00). Nothing is silently shifted.

  Keyboard: the grid is one tab stop (role="grid" with aria-activedescendant);
  arrow keys move the cursor, and the tooltip follows focus and hover.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { snapshot } from "@/data/snapshot";
import {
  LAYERS,
  WEATHER_ROWS,
  scaleBounds,
  scaleColor,
  type LayerId,
  type WeatherRow,
} from "@/grid/layer-scales";
import { dayHourSequence } from "@/grid/amsterdam-time";
import { formatBand, WINDOW_PARAMS } from "@/grid/green-window";

type Period = "month" | "season" | "year" | "full";
const PERIODS: { id: Period; label: string; days?: number }[] = [
  { id: "month", label: `Last ${WINDOW_PARAMS.TRAILING_DAYS} days`, days: WINDOW_PARAMS.TRAILING_DAYS },
  { id: "season", label: "Last 90 days", days: 90 },
  { id: "year", label: "Last 12 months" },
  { id: "full", label: `Full history ${snapshot.composites.years[0]?.year}–now` },
];

const SLOT_COUNT = 25;

interface Row {
  key: string;
  label: string;
  /** value per slot; null = gap or missing */
  cells: (number | null)[];
  /** wall-clock hour per slot, -1 = unused slot (DST gap) */
  slotHours: number[];
  /** slot -> index into the source day's arrays, -1 for gaps */
  slotSrc: number[];
  date: string | null;
  dst: "spring" | "fall" | "normal";
  weather: { wind: (number | null)[]; solar: (number | null)[]; temp: (number | null)[] } | null;
}

/** slot -> wall hour for a fixed 25-slot axis, per DST shape. */
function slotAxis(dst: "spring" | "fall" | "normal"): { slotHours: number[]; slotSrc: number[] } {
  const seq = dayHourSequence(dst);
  const slotHours = Array(SLOT_COUNT).fill(-1);
  const slotSrc = Array(SLOT_COUNT).fill(-1);
  seq.forEach((h, i) => {
    slotHours[i] = h;
    slotSrc[i] = i;
  });
  return { slotHours, slotSrc };
}

function useDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const mo = new MutationObserver(update);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short" });
const dayNum = new Intl.DateTimeFormat("en-GB", { day: "numeric" });

function shortDate(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return `${dayNum.format(d)} ${monthShort.format(d)}`;
}

export function AtlasHeatmap() {
  const dark = useDark();
  const [layer, setLayer] = useState<LayerId>("price");
  const [period, setPeriod] = useState<Period>("month");
  const weatherAvailable = snapshot.weather.available;
  const [weatherOn, setWeatherOn] = useState(weatherAvailable);
  const [cursor, setCursor] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const gw = snapshot.greenWindow;
  const greenBand = gw.green.modalBand;
  const redBand = gw.red.modalBand;

  /* ---- rows per period ---- */
  const rows: Row[] = useMemo(() => {
    if (period === "full") {
      const out: Row[] = [];
      for (const y of snapshot.composites.years) {
        for (let m = 0; m < 12; m++) {
          const cells = Array.from({ length: 24 }, (_, h) => y.series[layer]?.[h]?.[m] ?? null);
          out.push({
            key: `${y.year}-${m}`,
            label: `${y.year}-${String(m + 1).padStart(2, "0")}`,
            cells,
            slotHours: Array.from({ length: SLOT_COUNT }, (_, s) => (s < 24 ? s : -1)),
            slotSrc: Array.from({ length: SLOT_COUNT }, (_, s) => (s < 24 ? s : -1)),
            date: null,
            dst: "normal",
            weather: null,
          });
        }
      }
      return out;
    }
    const n = PERIODS.find((p) => p.id === period)?.days;
    const days = n ? snapshot.trailing.days.slice(-n) : snapshot.trailing.days;
    return days.map((d) => {
      const axis = slotAxis(d.dst);
      const cells = Array.from({ length: SLOT_COUNT }, (_, s) =>
        axis.slotSrc[s] >= 0 ? d[layer][axis.slotSrc[s]] ?? null : null,
      );
      return {
        key: d.date,
        label: shortDate(d.date),
        cells,
        slotHours: axis.slotHours,
        slotSrc: axis.slotSrc,
        date: d.date,
        dst: d.dst,
        weather: d.weather,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, layer]);

  const weatherOnEffective = weatherOn && weatherAvailable && period !== "full";

  /* ---- scale bounds over displayed layer values ---- */
  const bounds = useMemo(() => {
    const vals = rows.flatMap((r) => r.cells);
    return scaleBounds(vals);
  }, [rows]);

  const layerDef = LAYERS[layer];

  /* ---- markers: green band and red band slot columns ---- */
  const inBand = useCallback(
    (row: Row, col: number, band: { startHour: number; endHour: number } | null) => {
      if (!band) return false;
      const h = row.slotHours[col];
      return h >= band.startHour && h <= band.endHour;
    },
    [],
  );

  const isSingle = useCallback(
    (row: Row, col: number, side: "green" | "red") => {
      if (!row.date) return false;
      const h = row.slotHours[col];
      if (h < 0) return false;
      const singles = (side === "green" ? gw.green : gw.red).singles[row.date] ?? [];
      const bands = (side === "green" ? gw.green : gw.red).bands[row.date] ?? [];
      return singles.includes(h) && !bands.some((b) => h >= b.startHour && h <= b.endHour);
    },
    [gw],
  );

  /* ---- cursor helpers ---- */
  const active = hover ?? cursor;
  const clampCursor = useCallback(
    (row: number, col: number) => {
      const r = Math.max(0, Math.min(rows.length - 1, row));
      const c = Math.max(0, Math.min(SLOT_COUNT - 1, col));
      setCursor({ row: r, col: c });
    },
    [rows.length],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const { row, col } = cursor;
    if (e.key === "ArrowLeft") { clampCursor(row, col - 1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { clampCursor(row, col + 1); e.preventDefault(); }
    else if (e.key === "ArrowUp") { clampCursor(row - 1, col); e.preventDefault(); }
    else if (e.key === "ArrowDown") { clampCursor(row + 1, col); e.preventDefault(); }
    else if (e.key === "Home") { clampCursor(0, 0); e.preventDefault(); }
    else if (e.key === "End") { clampCursor(rows.length - 1, SLOT_COUNT - 1); e.preventDefault(); }
  };

  const cellId = (r: number, c: number) => `hm-cell-${r}-${c}`;

  const activeRow = rows[active.row];
  const activeHour = activeRow?.slotHours[active.col] ?? -1;
  const activeSrc = activeRow?.slotSrc[active.col] ?? -1;
  const activeValue = activeSrc >= 0 ? activeRow?.cells[active.col] ?? null : null;
  const activeHourLabel =
    activeHour < 0
      ? "hour does not exist on this day (DST)"
      : activeRow?.dst === "fall" && activeHour === 2 && active.col === 3
        ? "02:00 +01:00 (second 02:00)"
        : activeRow?.dst === "fall" && activeHour === 2
          ? "02:00 +02:00 (first 02:00)"
          : `${String(activeHour).padStart(2, "0")}:00`;

  const summary = useMemo(() => {
    const periodLabel = PERIODS.find((p) => p.id === period)?.label ?? period;
    return `Heatmap of ${layerDef.label.toLowerCase()}, hour by day, ${periodLabel.toLowerCase()}, NL. ` +
      `${rows.length} rows. ` +
      (greenBand ? `Green window band ${formatBand(greenBand)} outlined in green; ` : "") +
      (redBand ? `red hours band ${formatBand(redBand)} outlined in red.` : "");
  }, [layerDef, period, rows.length, greenBand, redBand]);

  const liveText = activeRow
    ? `${activeRow.label}, ${activeHourLabel}, ${layerDef.label.toLowerCase()} ${activeValue != null ? layerDef.format(activeValue) : "no data"}`
    : "";

  const cellColor = (v: number | null) =>
    v == null || !bounds ? "var(--muted)" : scaleColor(v, layerDef, bounds.lo, bounds.hi, dark) ?? "var(--muted)";

  const weatherBounds = useMemo(() => {
    const out: Partial<Record<WeatherRow["id"], { lo: number; hi: number }>> = {};
    for (const wdef of WEATHER_ROWS) {
      const vals: (number | null)[] = [];
      for (const r of rows) if (r.weather) vals.push(...(r.weather[wdef.id] ?? []));
      const b = scaleBounds(vals);
      if (b) out[wdef.id] = b;
    }
    return out;
  }, [rows]);

  const weatherCellColor = (v: number | null, id: WeatherRow["id"]) => {
    const b = weatherBounds[id];
    const rowDef = WEATHER_ROWS.find((w) => w.id === id)!;
    if (v == null || !b) return "var(--muted)";
    return scaleColor(v, rowDef, b.lo, b.hi, dark) ?? "var(--muted)";
  };

  /* tooltip position */
  useEffect(() => {
    const grid = gridRef.current;
    const tip = tipRef.current;
    if (!grid || !tip) return;
    const cell = grid.querySelector(`#${cellId(active.row, active.col)}`) as HTMLElement | null;
    if (!cell) return;
    const gr = grid.getBoundingClientRect();
    const cr = cell.getBoundingClientRect();
    const w = tip.offsetWidth;
    let left = cr.left - gr.left + cr.width / 2 - w / 2;
    left = Math.max(4, Math.min(left, gr.width - w - 4));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, cr.top - gr.top - tip.offsetHeight - 6)}px`;
  });

  return (
    <div>
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Layer" className="inline-flex flex-wrap gap-1 rounded-full border border-border bg-card/80 p-1">
          {(Object.keys(LAYERS) as LayerId[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={layer === id}
              onClick={() => setLayer(id)}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium ${
                layer === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {LAYERS[id].label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Period" className="inline-flex flex-wrap gap-1 rounded-full border border-border bg-card/80 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={period === p.id}
              onClick={() => { setPeriod(p.id); setCursor({ row: 0, col: 0 }); }}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium ${
                period === p.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={weatherOn}
          disabled={!weatherAvailable || period === "full"}
          onClick={() => setWeatherOn((v) => !v)}
          title={period === "full" ? "Weather overlay is available in the day views" : undefined}
          className={`cursor-pointer rounded-full border border-border px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
            weatherOn && weatherAvailable ? "bg-primary text-primary-foreground" : "bg-card/80 text-muted-foreground hover:text-foreground"
          }`}
        >
          Weather overlay
        </button>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Colour spans the 5th–95th percentile of the displayed{" "}
        {layerDef.label.toLowerCase()} values
        {bounds ? ` (${layerDef.format(bounds.lo)} – ${layerDef.format(bounds.hi)})` : ""}. Grey cells are gaps (no
        data). {layer === "intensity" ? "Basis: generation mix — imports not attributed." : ""}
      </p>

      {/* grid */}
      <div ref={gridRef} className="relative mt-2 overflow-x-auto">
        <div
          role="grid"
          aria-label={summary}
          aria-activedescendant={cellId(cursor.row, cursor.col)}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseMove={(e) => {
            const t = (e.target as HTMLElement).closest("[data-cell]") as HTMLElement | null;
            if (t) setHover({ row: Number(t.dataset.row), col: Number(t.dataset.col) });
          }}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setCursor((c) => c)}
          className="min-w-[640px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {/* column headers */}
          <div className="flex" role="row" aria-hidden="true">
            <div className="w-16 shrink-0" />
            {Array.from({ length: SLOT_COUNT }, (_, s) => {
              const label = s === 3 ? "02+01" : s < 3 ? String(s).padStart(2, "0") : String(s - 1).padStart(2, "0");
              return (
                <div key={s} role="columnheader" className="flex-1 text-center text-[9px] text-muted-foreground">
                  {label}
                </div>
              );
            })}
          </div>
          {rows.map((row, r) => (
            <div key={row.key}>
            <div role="row" className="flex items-stretch">
              <div role="rowheader" className="w-16 shrink-0 truncate py-px pr-1 text-right text-[9px] text-muted-foreground">
                {r % Math.max(1, Math.floor(rows.length / 30)) === 0 ? row.label : ""}
              </div>
              {Array.from({ length: SLOT_COUNT }, (_, c) => {
                const h = row.slotHours[c];
                const src = row.slotSrc[c];
                const v = src >= 0 ? row.cells[c] : null;
                const green = inBand(row, c, greenBand);
                const red = inBand(row, c, redBand);
                const single = src >= 0 && (isSingle(row, c, "green") || isSingle(row, c, "red"));
                const isGap = h < 0;
                return (
                  <div
                    key={c}
                    id={cellId(r, c)}
                    data-cell
                    data-row={r}
                    data-col={c}
                    role="gridcell"
                    aria-label={
                      isGap
                        ? `${row.label}, hour slot ${c}: no such hour on this day (DST)`
                        : `${row.label}, ${row.dst === "fall" && h === 2 && c === 3 ? "02:00 +01:00" : row.dst === "fall" && h === 2 ? "02:00 +02:00" : `${String(h).padStart(2, "0")}:00`}, ${layerDef.label.toLowerCase()} ${v != null ? layerDef.format(v) : "no data"}${green ? ", in the green window" : ""}${red ? ", red hour" : ""}`
                    }
                    className={`relative flex-1 motion-safe:transition-[box-shadow] ${
                      r === active.row && c === active.col ? "z-10" : ""
                    }`}
                    style={{
                      height: period === "year" ? 7 : period === "season" ? 12 : 18,
                      background: isGap ? "color-mix(in oklab, var(--muted) 55%, transparent)" : cellColor(v),
                      boxShadow:
                        green && !red
                          ? "inset 0 0 0 2px var(--gg-green-band)"
                          : red
                            ? "inset 0 0 0 2px var(--gg-red-band)"
                            : r === active.row && c === active.col
                              ? "inset 0 0 0 2px var(--ring)"
                              : undefined,
                    }}
                  >
                    {single && (
                      <span
                        aria-hidden="true"
                        className="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {/* weather overlay: three thin strips per day, sharing the 25-slot column axis */}
            {weatherOnEffective && row.weather &&
              WEATHER_ROWS.map((wdef, wi) => (
                <div key={`${row.key}-${wdef.id}`} role="row" aria-hidden="true" className="flex items-stretch">
                  <div className="w-16 shrink-0 truncate py-px pr-1 text-right text-[8px] text-muted-foreground">
                    {wi === 0 ? wdef.label : ""}
                  </div>
                  {Array.from({ length: SLOT_COUNT }, (_, c) => {
                    const src = row.slotSrc[c];
                    const v = src >= 0 ? row.weather?.[wdef.id]?.[src] ?? null : null;
                    return (
                      <div
                        key={c}
                        className="flex-1"
                        style={{
                          height: 4,
                          background: src < 0 ? "color-mix(in oklab, var(--muted) 55%, transparent)" : weatherCellColor(v, wdef.id),
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* tooltip */}
        <div
          ref={tipRef}
          aria-hidden="true"
          className="pointer-events-none absolute z-20 w-64 rounded-lg border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg"
        >
          {activeRow && (
            <>
              <p className="font-semibold">{activeRow.date ? `${shortDate(activeRow.date)}${activeRow.dst !== "normal" ? ` (${activeRow.dst === "fall" ? "25 h" : "23 h"} day)` : ""}` : activeRow.label}</p>
              <p className="text-muted-foreground">{activeHourLabel}</p>
              <p className="mt-1">
                {layerDef.label}:{" "}
                <span className="font-medium tabular-nums">{activeValue != null ? layerDef.format(activeValue) : "no data"}</span>
              </p>
              {inBand(activeRow, active.col, greenBand) && <p className="text-gg-green-band">In the green window band</p>}
              {inBand(activeRow, active.col, redBand) && <p className="text-gg-red-band">Red hour band</p>}
              {weatherOnEffective && activeRow.weather && activeSrc >= 0 && (
                <p className="mt-1 text-muted-foreground">
                  Wind {activeRow.weather.wind[activeSrc] != null ? `${activeRow.weather.wind[activeSrc]!.toFixed(1)} km/h` : "—"},
                  solar {activeRow.weather.solar[activeSrc] != null ? `${Math.round(activeRow.weather.solar[activeSrc]!)} W/m²` : "—"},
                  temp {activeRow.weather.temp[activeSrc] != null ? `${activeRow.weather.temp[activeSrc]!.toFixed(1)} °C` : "—"}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* legend */}
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{bounds ? layerDef.format(bounds.lo) : "—"}</span>
        <div
          aria-hidden="true"
          className="h-2 flex-1 rounded-full"
          style={{
            background: `linear-gradient(to right, ${dark ? layerDef.stops.dark[0] : layerDef.stops.light[0]}, ${dark ? layerDef.stops.dark[1] : layerDef.stops.light[1]})`,
          }}
        />
        <span>{bounds ? layerDef.format(bounds.hi) : "—"}</span>
        <span className="ml-2 inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block size-2 rounded-full border-2 border-gg-green-band" /> green window
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block size-2 rounded-full border-2 border-gg-red-band" /> red hours
        </span>
      </div>

      <p className="sr-only" aria-live="polite">
        {liveText}
      </p>
    </div>
  );
}
