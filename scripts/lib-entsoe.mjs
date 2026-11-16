/*
  ENTSO-E Transparency Platform fetch layer for the NL zone, used by
  backfill.mjs, snapshot.mjs and probe-entsoe.mjs.

  Verified contract (docs/data-notes.md, section 6):

  - GET only, XML: https://web-api.tp.entsoe.eu/api
  - authentication via the `securityToken` query parameter, read from the
    ENTSOE_API_TOKEN environment variable (Actions secret). The token is
    never logged, never written to the disk cache (cache keys are built
    from the document parameters only) and never committed.
  - generation per production type: documentType=A69, processType=A01,
    in_Domain=10YNL----------L (NL bidding zone); one timeSeries per
    psrType, quantities in MW.
  - actual total load: documentType=A65, processType=A01, out_Domain=10YNL----------L
    (the load document takes out_Domain; generation takes in_Domain).
  - periodStart/periodEnd as yyyyMMddHHmm in UTC; maximum one year per
    request, so windows are chunked by year at most.
  - rate limit 400 requests/minute per IP and per token; a 429 imposes a
    ten-minute ban. This module paces at one request per second (well
    inside the limit), one at a time, and on 429 waits the Retry-After
    header (fallback 600 s, the ban length) times the attempt number,
    capped at 900 s, up to 4 attempts.
  - timestamps in the XML are UTC ("...Z") and mark the START of each
    interval; the site renders Europe/Amsterdam local time, so records are
    keyed through the same bucketHours/hourKey path as the energy-charts
    series (parseTs handles the Z suffix, amsterdamLocal converts). The
    build verifies the conversion hour-by-hour against an unchanged
    energy-charts series (verifyHourAlignment).

  The renewable set is computed explicitly from the A69 per-type series:
  Solar, Wind Onshore, Wind Offshore, Biomass, Hydro Run-of-river and
  poundage, Hydro Water Reservoir, Hydro Pumped Storage (generation side
  only — A69 is generation), Geothermal, Waste. The remaining production
  types feed the site's "others" bucket (the emission-factor table is
  keyed by energy-charts series ids and is not changed).
*/

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, ".cache");

export const ENTSOE_BASE = "https://web-api.tp.entsoe.eu/api";
export const NL_DOMAIN_EIC = "10YNL----------L";
export const PROCESS_TYPE = "A01";
export const DOC_GENERATION = "A69"; // actual generation per production type
export const DOC_LOAD = "A65"; // actual total load

const MIN_SPACING_MS = 1_000; // 60 req/min, far below the 400/min limit
const MAX_ATTEMPTS = 4;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastRequestAt = 0;
async function ensureSpacing() {
  const wait = lastRequestAt + MIN_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * ENTSO-E psrType code -> site series id (the emission-factor table keys)
 * plus the renewable flag. Renewable set per the method drawer: Solar,
 * Wind Onshore, Wind Offshore, Biomass, Hydro Run-of-river and poundage,
 * Hydro Water Reservoir, Hydro Pumped Storage (generation side), Geothermal,
 * Waste. Everything else lands in "others" and counts toward total
 * generation but not toward the renewable set.
 */
export const PSR_TYPES = {
  B01: { name: "Biomass", series: "biomass", renewable: true },
  B02: { name: "Fossil Brown coal/Lignite", series: "fossil_hard_coal", renewable: false },
  B03: { name: "Fossil Coal-derived gas", series: "fossil_gas", renewable: false },
  B04: { name: "Fossil Gas", series: "fossil_gas", renewable: false },
  B05: { name: "Fossil Hard coal", series: "fossil_hard_coal", renewable: false },
  B06: { name: "Fossil Oil", series: "others", renewable: false },
  B07: { name: "Fossil Oil shale", series: "others", renewable: false },
  B08: { name: "Fossil Peat", series: "others", renewable: false },
  B09: { name: "Geothermal", series: "others", renewable: true },
  B10: { name: "Hydro Pumped Storage", series: "others", renewable: true },
  B11: { name: "Hydro Run-of-river and poundage", series: "others", renewable: true },
  B12: { name: "Hydro Water Reservoir", series: "others", renewable: true },
  B13: { name: "Marine", series: "others", renewable: false },
  B14: { name: "Nuclear", series: "nuclear", renewable: false },
  B15: { name: "Other", series: "others", renewable: false },
  B16: { name: "Solar", series: "solar", renewable: true },
  B17: { name: "Waste", series: "waste", renewable: true },
  B18: { name: "Wind Offshore", series: "wind_offshore", renewable: true },
  B19: { name: "Wind Onshore", series: "wind_onshore", renewable: true },
  B20: { name: "Other renewable", series: "others", renewable: false },
};

// The renewable MW sum is computed from the per-psrType renewable flags
// above (not from a series list), because the site's "others" bucket mixes
// renewable hydro/geothermal with non-renewable residual types.

/** Format a UTC ms instant as ENTSO-E yyyyMMddHHmm. */
export function entsoeTs(utcMs) {
  const d = new Date(utcMs);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

/**
 * Split [startUtcMs, endUtcMs) into ENTSO-E request windows of at most one
 * year each (the API maximum), aligned to UTC year boundaries where
 * possible. periodStart inclusive, periodEnd exclusive.
 */
export function entsoeWindows(startUtcMs, endUtcMs) {
  const windows = [];
  let start = startUtcMs;
  while (start < endUtcMs) {
    const year = new Date(start).getUTCFullYear();
    const yearEnd = Date.UTC(year + 1, 0, 1);
    const end = Math.min(endUtcMs, yearEnd);
    windows.push({ periodStart: entsoeTs(start), periodEnd: entsoeTs(end) });
    start = end;
  }
  return windows;
}

/**
 * Build the request URL. The token never leaves this function's URL.
 * A69 (generation) takes in_Domain; A65 (actual total load) takes
 * out_Domain — same NL bidding zone EIC, different parameter name.
 */
function entsoeUrl({ documentType, periodStart, periodEnd }) {
  const token = process.env.ENTSOE_API_TOKEN;
  if (!token) throw new Error("ENTSOE_API_TOKEN is not set (Actions secret); ENTSO-E fetch refused");
  const url = new URL(ENTSOE_BASE);
  url.searchParams.set("securityToken", token);
  url.searchParams.set("documentType", documentType);
  url.searchParams.set("processType", PROCESS_TYPE);
  url.searchParams.set(documentType === DOC_LOAD ? "out_Domain" : "in_Domain", NL_DOMAIN_EIC);
  url.searchParams.set("periodStart", periodStart);
  url.searchParams.set("periodEnd", periodEnd);
  return url;
}

/** Cache key from document parameters only — never contains the token. */
function cacheKey(params) {
  return "entsoe-" + createHash("sha1").update(JSON.stringify(params)).digest("hex");
}

/**
 * Fetch one ENTSO-E document (XML text), paced at 1 req/s, retried with
 * backoff, cached on disk. Returns { ok, xml, status, fromCache, error }.
 * Never throws; never includes the token in errors or logs.
 */
export async function fetchEntsoe(params, { fresh = false, label = "" } = {}) {
  const key = cacheKey(params);
  if (!fresh) {
    try {
      const xml = await readFile(path.join(CACHE_DIR, key + ".xml"), "utf8");
      return { ok: true, xml, fromCache: true, status: 200 };
    } catch {
      // not cached: fetch
    }
  }
  const url = entsoeUrl(params);
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await ensureSpacing();
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/xml" },
        signal: AbortSignal.timeout(120_000),
      });
      if (response.status === 429) {
        const ra = Number(response.headers.get("retry-after")) || 600; // 429 = ten-minute ban
        const wait = Math.min(ra * attempt, 900_000);
        lastError = new Error(`HTTP 429 for ENTSO-E ${label || params.documentType} (retry-after ${ra}s)`);
        console.warn(`  429 on ENTSO-E ${label || params.documentType}, waiting ${Math.round(wait / 1000)}s (attempt ${attempt})`);
        await sleep(wait);
        continue;
      }
      if (!response.ok) {
        // 4xx other than 429 is a client error (bad parameter combination);
        // retrying cannot help, so fail immediately instead of burning
        // attempts against the ten-minute ban.
        if (response.status >= 400 && response.status < 500) {
          const body = (await response.text().catch(() => "")).slice(0, 300);
          return {
            ok: false,
            error: new Error(`HTTP ${response.status} for ENTSO-E ${label || params.documentType}${body ? `: ${body}` : ""}`),
            status: response.status,
          };
        }
        throw new Error(`HTTP ${response.status} for ENTSO-E ${label || params.documentType}`);
      }
      const xml = await response.text();
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(path.join(CACHE_DIR, key + ".xml"), xml, "utf8");
      return { ok: true, xml, fromCache: false, status: response.status };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const wait = 5_000 * attempt;
        console.warn(`  ${String(error.message ?? error)} on ENTSO-E ${label || params.documentType}, retrying in ${wait / 1000}s (attempt ${attempt})`);
        await sleep(wait);
      }
    }
  }
  return { ok: false, error: lastError, status: null };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "timeSeries" || name === "Period" || name === "Point",
  parseTagValue: false,
  trimValues: true,
});

/** Recursively collect every value stored under the given key. */
function collect(node, key, out = []) {
  if (node == null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collect(item, key, out);
    return out;
  }
  if (key in node) {
    const v = node[key];
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
  }
  for (const v of Object.values(node)) collect(v, key, out);
  return out;
}

/** Parse an ISO8601 duration like PT60M / PT15M / PT1H into ms. */
function resolutionMs(res) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(res ?? ""));
  if (!m) return null;
  const [, d, h, min, s] = m;
  const ms = (Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3_600 + Number(min ?? 0) * 60 + Number(s ?? 0)) * 1_000;
  return ms > 0 ? ms : null;
}

/**
 * Expand one ENTSO-E document XML into flat interval records:
 * [{ timestamp: ISO-Z, psrType: string|null, mw: number }].
 * Point positions are 1-based; each point covers [ts, ts+resolution).
 */
export function parseEntsoeIntervals(xml) {
  const doc = parser.parse(xml);
  const series = collect(doc, "timeSeries");
  const records = [];
  const seenPsr = new Set();
  for (const ts of series) {
    // psrType is a child element in A69 responses (an attribute in some
    // other document types); accept both.
    const rawPsr = ts["@_psrType"] ?? ts.psrType ?? null;
    const psrType = typeof rawPsr === "string" ? rawPsr : (rawPsr?.["#text"] ?? null);
    if (psrType) seenPsr.add(psrType);
    const periods = ts.Period ?? [];
    for (const period of periods) {
      const start = Date.parse(period.timeInterval?.["@_start"] ?? period.timeInterval?.start);
      if (!Number.isFinite(start)) continue;
      const resMs = resolutionMs(period["@_resolution"] ?? period.resolution);
      if (resMs == null) continue;
      const points = period.Point ?? [];
      for (const point of points) {
        const pos = Number(point["@_position"] ?? point.position);
        const qty = Number(point["@_quantity"] ?? point.quantity);
        if (!Number.isFinite(pos) || !Number.isFinite(qty)) continue;
        const tsMs = start + (pos - 1) * resMs;
        records.push({ timestamp: new Date(tsMs).toISOString(), psrType, mw: qty, ms: resMs });
      }
    }
  }
  return {
    records,
    psrTypes: [...seenPsr].sort(),
    // Debug aid for the probe gate: the response body never contains the
    // token, so a short snippet is safe to log when nothing was found.
    rootKeys: records.length === 0 ? Object.keys(doc ?? {}) : undefined,
    snippet: records.length === 0 ? String(xml ?? "").slice(0, 400) : undefined,
  };
}

/**
 * Fetch A69 + A65 over [startUtcMs, endUtcMs) (chunked by year at most)
 * and merge them into one energy-charts-shaped envelope the existing
 * pipeline already consumes:
 *   { data: [{ timestamp: ISO-Z, values: { <site series id>, load,
 *               residual_load, renewable_share_of_generation,
 *               renewable_share_of_load } }] }
 * Series ids match the energy-charts public_power vocabulary so
 * slotsFromEnvelopes/daysToTrailing/intensity/records work unchanged.
 */
export async function fetchNlPowerEnvelope(startUtcMs, endUtcMs, { fresh = false } = {}) {
  const windows = entsoeWindows(startUtcMs, endUtcMs);
  const byTs = new Map(); // ISO ts -> { values: Record<string, number>, renMW, totalMW, loadMW, ms }
  const psrSeen = new Set();
  let failures = 0;

  for (const w of windows) {
    const gen = await fetchEntsoe({ documentType: DOC_GENERATION, ...w }, { fresh, label: `A69 ${w.periodStart}-${w.periodEnd}` });
    if (!gen.ok) {
      failures += 1;
      console.warn(`  ENTSO-E A69 ${w.periodStart}-${w.periodEnd} FAILED: ${gen.error?.message ?? gen.error}`);
      continue;
    }
    const { records, psrTypes, rootKeys, snippet } = parseEntsoeIntervals(gen.xml);
    for (const p of psrTypes) psrSeen.add(p);
    if (gen.ok && records.length === 0) {
      console.warn(`  ENTSO-E A69 ${w.periodStart}-${w.periodEnd} returned no timeSeries; root keys: ${JSON.stringify(rootKeys)}; body starts: ${snippet}`);
    }
    for (const r of records) {
      const psr = PSR_TYPES[r.psrType];
      const seriesId = psr?.series ?? "others";
      const rec = byTs.get(r.timestamp) ?? { values: {}, renMW: 0, totalMW: 0, loadMW: null, ms: 0 };
      rec.values[seriesId] = (rec.values[seriesId] ?? 0) + r.mw;
      rec.totalMW += r.mw;
      rec.ms = rec.ms || r.ms;
      if (psr?.renewable) rec.renMW += r.mw;
      byTs.set(r.timestamp, rec);
    }
    const load = await fetchEntsoe({ documentType: DOC_LOAD, ...w }, { fresh, label: `A65 ${w.periodStart}-${w.periodEnd}` });
    if (!load.ok) {
      failures += 1;
      console.warn(`  ENTSO-E A65 ${w.periodStart}-${w.periodEnd} FAILED: ${load.error?.message ?? load.error}`);
      continue;
    }
    const loadParsed = parseEntsoeIntervals(load.xml);
    if (load.ok && loadParsed.records.length === 0) {
      console.warn(`  ENTSO-E A65 ${w.periodStart}-${w.periodEnd} returned no timeSeries; root keys: ${JSON.stringify(loadParsed.rootKeys)}; body starts: ${loadParsed.snippet}`);
    }
    for (const r of loadParsed.records) {
      const rec = byTs.get(r.timestamp) ?? { values: {}, renMW: 0, totalMW: 0, loadMW: null, ms: 0 };
      rec.loadMW = (rec.loadMW ?? 0) + r.mw;
      rec.values.load = rec.loadMW;
      rec.ms = rec.ms || r.ms;
      byTs.set(r.timestamp, rec);
    }
  }

  const data = [...byTs.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([ts, rec]) => {
      const v = { ...rec.values };
      if (rec.totalMW > 0) v.renewable_share_of_generation = (rec.renMW / rec.totalMW) * 100;
      if (rec.loadMW != null && rec.loadMW > 0) {
        v.renewable_share_of_load = (rec.renMW / rec.loadMW) * 100;
        // residual load, energy-charts definition (verified against the
        // per-type feeds): load - wind onshore - wind offshore - solar.
        const ws = (v.wind_onshore ?? 0) + (v.wind_offshore ?? 0) + (v.solar ?? 0);
        v.residual_load = rec.loadMW - ws;
      }
      return { timestamp: ts, values: v, ms: rec.ms };
    });

  return {
    ok: failures === 0,
    failures,
    envelope: { data },
    psrTypes: [...psrSeen].sort(),
    windows,
  };
}

/**
 * Hour-by-hour alignment check of the ENTSO-E-derived slots against an
 * unchanged existing series (energy-charts price) over the same window.
 * `hourKeys` are the (local date, hour, offset) keys from bucketHours.
 * Every ENTSO-E hour key must exist in the reference (a shifted or
 * duplicated conversion would show up as "extra"); reference hours
 * missing from ENTSO-E are a data lag, reported but not an error.
 * Returns { matched, missing, extra } and throws when extra > 0.
 */
export function verifyHourAlignment(entsoeKeys, referenceKeys, { label = "window" } = {}) {
  const ref = new Set(referenceKeys);
  const ent = new Set(entsoeKeys);
  let matched = 0;
  const extra = [];
  for (const k of entsoeKeys) {
    if (ref.has(k)) matched += 1;
    else extra.push(k);
  }
  const missing = [...ref].filter((k) => !ent.has(k)).length;
  if (extra.length > 0) {
    throw new Error(
      `ENTSO-E UTC->CET/CEST alignment check FAILED for ${label}: ${extra.length} hour keys not present in the reference series (first: ${extra[0]}). Aborting; nothing was written.`,
    );
  }
  return { matched, missing, extra: extra.length };
}
