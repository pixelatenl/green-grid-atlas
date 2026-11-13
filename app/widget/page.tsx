"use client";

/*
  The /widget page: minimal, no family header or footer, family styling.
  Renders the NL green window plus tomorrow's price shape from the
  same-origin snapshot JSON (/data/snapshot.json, served from public/).
  Copy says snapshot-fresh daily; it is never live.
*/

import { useEffect, useState } from "react";
import Link from "next/link";
import { FAMILY } from "@/family";
import { formatBand } from "@/grid/green-window";
import type { Snapshot } from "@/data/snapshot";

export default function WidgetPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/snapshot.json", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => {
        if (!cancelled) setSnap(j as Snapshot);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const gw = snap?.greenWindow;
  const band = gw?.green.modalBand ?? null;
  const nextDay = snap?.nextDay;
  const prices = nextDay?.price15m?.filter((v): v is number => v != null) ?? [];
  const pmax = prices.length ? Math.max(...prices) : 1;
  const pmin = prices.length ? Math.min(...prices) : 0;

  return (
    <div className="mx-auto max-w-[420px] p-4">
      <p className="text-xs font-medium tracking-wide text-primary uppercase">{FAMILY.productName}</p>
      <h1 className="mt-1 text-2xl font-black leading-tight tracking-tight">
        The green window{band ? (
          <>
            {" "}is <span className="text-brand-accent">{formatBand(band)}</span>
          </>
        ) : (
          ""
        )}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {gw
          ? `Cheap and renewable on ${Math.round(gw.green.frequencyShare * 1000) / 10}% of the trailing ${gw.green.days} days. Snapshot-fresh as of ${snap?.retrievedAt.slice(0, 10)} — daily, never live.`
          : error
            ? "Snapshot unavailable right now."
            : "Loading snapshot…"}
      </p>

      {nextDay && prices.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Tomorrow&apos;s price shape{nextDay.deliveryDate ? ` — ${nextDay.deliveryDate}` : ""} (EUR/MWh)
          </p>
          <div
            className="mt-1 flex h-24 items-end gap-[1px] rounded-lg border border-border p-1"
            role="img"
            aria-label={`Tomorrow's day-ahead price by quarter hour, ${nextDay.deliveryDate ?? "next day"}: from ${pmin.toFixed(1)} to ${pmax.toFixed(1)} EUR/MWh.`}
          >
            {nextDay.price15m.map((v, i) => {
              const h = v == null ? 0 : ((v - pmin) / (pmax - pmin || 1)) * 100;
              return (
                <div
                  key={i}
                  tabIndex={0}
                  className="chart-tooltip-trigger flex-1 rounded-sm bg-primary"
                  style={{ height: `${Math.max(2, h)}%` }}
                  aria-label={`Quarter hour ${i}: ${v != null ? `${v.toFixed(2)} EUR/MWh` : "no data"}`}
                >
                  <title>
                    {String(Math.floor(i / 4)).padStart(2, "0")}:{String((i % 4) * 15).padStart(2, "0")} —{" "}
                    {v != null ? `${v.toFixed(2)} EUR/MWh` : "no data"}
                  </title>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        <Link href="/" className="underline underline-offset-4 hover:text-foreground">
          Full atlas
        </Link>{" "}
        · data: energy-charts.info (CC BY 4.0), prices Bundesnetzagentur | SMARD.de (CC BY 4.0)
      </p>
    </div>
  );
}
