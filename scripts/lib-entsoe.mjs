/*
  ENTSO-E Transparency Platform fetch layer for the NL zone, used by
  backfill.mjs, snapshot.mjs and probe-entsoe.mjs.

  Verified contract (docs/data-notes.md, section 6):

  - GET only, XML: https://web-api.tp.entsoe.eu/api
  - authentication via the `securityToken` query parameter, read from the
    ENTSOE_API_TOKEN environment variable (Actions secret). The token is
    never logged, never written to the disk cache (cache keys are built
    from the document parameters only) and never committed.
  - actual generation per production type: documentType=A75,
    processType=A16 (realised), in_Domain=10YNL----------L (NL bidding
    zone); one TimeSeries per psrType, quantities in MW. (The A69/A01
    combination returns only the wind-and-solar day-ahead forecast,
    businessType A93/A94, verified against the live API in the probe
    gate; A75/A16 is the actual per-type document.)
  - actual total load: documentType=A65, processType=A16 (realised),
    outBiddingZone_Domain=10YNL----------L (the load document requires
    outBiddingZone_Domain; generation takes in_Domain).
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

  The renewable set is computed explicitly from the A75 per-type series:
  Solar, Wind Onshore, Wind Offshore, Biomass, Hydro Run-of-river and
  poundage, Hydro Water Reservoir, Hydro Pumped Storage (generation side
  only: the generation document carries generation), Geothermal, Waste. The remaining production
  types feed the site's "others" bucket (the emission-factor table is
  keyed by energy-charts series ids and is not changed).

  Fetch integrity (docs/data-notes.md section 6, dual-version observation):
  every A75 response carries each psrType in two TimeSeries blocks (two
  coexisting published collections of the same window; the documents carry no
  docStatus/revisionNumber), so the parser dedups with a structural
  block-completeness preference: the record from the block with the greater
  total coverage wins, never by value, and reports per-psrType copy statistics
  and block coverage before dedup. fetchNlPowerEnvelope then guards every
  window with the coherence ratio against the window's A65 load document (the
  sole gated check), with bounded fresh retries (INTEGRITY constants below).
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
export const PROCESS_TYPE = "A16"; // realised
export const DOC_GENERATION = "A75"; // actual generation per production type
export const DOC_LOAD = "A65"; // actual total load
// The document/process pair named in the original change request. It is
// kept for the probe's as-specified comparison: A69/A01 is the wind-and-solar
// day-ahead forecast, not actual generation per type.
export const AS_SPECIFIED = { DOC: "A69", PROCESS: "A01" };

/*
  Fetch-integrity constants for the per-window acceptance guard in
  fetchNlPowerEnvelope (docs/data-notes.md section 6, dual-version
  observation). These are fetch-integrity constants, NOT probe-gate
  criteria; they are never edited to make a run pass.

  - COHERENCE_RATIO_MIN/MAX 0.6..1.4: total generation energy / total load
    energy over the timestamps where generation data exists. Dutch annual
    generation has been roughly 85-105% of load (CBS: record production and
    record exports in 2025); the defective platform variant observed in
    probe runs 43975014678 and 44049087239 sat at 0.28-0.32 (33.7 TWh/yr
    generation against a healthy 118.7 TWh/yr load document). This ratio is
    the SOLE acceptance check of a window attempt.
  - MATERIALITY_FLOOR_MW 50: per-copy divergence is only REPORTED as
    evidence (never gated) for psrTypes whose largest per-copy mean exceeds
    this floor. Probe run 44049087239 proved that both published collections
    coexist in every A75 document, so large per-copy divergences are the
    normal serving pattern, not a defect signal; the withdrawn ambiguity
    factor-2 gate of addendum 3 rejected healthy documents because of it.
  - MAX_WINDOW_ATTEMPTS 3: an attempt failing the coherence check re-fetches
    the window's A75 document fresh (bypassing the disk cache, paced as
    usual); the first passing attempt is kept.
*/
export const INTEGRITY = {
  COHERENCE_RATIO_MIN: 0.6,
  COHERENCE_RATIO_MAX: 1.4,
  MATERIALITY_FLOOR_MW: 50,
  MAX_WINDOW_ATTEMPTS: 3,
};

const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;

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
  // B16 Solar plus B20 Other renewable form one aggregate series: for the NL
  // zone the TSO reports distribution-connected renewables (solar plus
  // distribution-level wind and other renewables) as a single upscaled
  // estimate under B20, while B16 carries only the small directly measured
  // share. The site ships the aggregate, honestly labeled, and never splits
  // it; every component is renewable, so the renewable share is unaffected.
  B16: { name: "Solar", series: "distribution_renewables", renewable: true },
  B17: { name: "Waste", series: "waste", renewable: true },
  B18: { name: "Wind Offshore", series: "wind_offshore", renewable: true },
  B19: { name: "Wind Onshore", series: "wind_onshore", renewable: true },
  B20: { name: "Other renewable (TSO aggregate of distribution-connected renewables)", series: "distribution_renewables", renewable: true },
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
 * A75 (generation) takes in_Domain; A65 (actual total load) requires
 * outBiddingZone_Domain: same NL bidding zone EIC, different parameter
 * name (the API rejects A65 without it, verified in the probe gate).
 */
function entsoeUrl({ documentType, periodStart, periodEnd, processType = PROCESS_TYPE }) {
  const token = process.env.ENTSOE_API_TOKEN;
  if (!token) throw new Error("ENTSOE_API_TOKEN is not set (Actions secret); ENTSO-E fetch refused");
  const url = new URL(ENTSOE_BASE);
  url.searchParams.set("securityToken", token);
  url.searchParams.set("documentType", documentType);
  url.searchParams.set("processType", processType);
  url.searchParams.set(documentType === DOC_LOAD ? "outBiddingZone_Domain" : "in_Domain", NL_DOMAIN_EIC);
  url.searchParams.set("periodStart", periodStart);
  url.searchParams.set("periodEnd", periodEnd);
  return url;
}

/** Cache key from document parameters only; never contains the token. */
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
          const body = (await response.text().catch(() => "")).slice(0, 1500);
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
  // The live documents use capitalized TimeSeries (some use lowercase);
  // Period and Point are capitalized in both.
  isArray: (name) => name === "TimeSeries" || name === "timeSeries" || name === "Period" || name === "Point",
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

/** Recursive histogram of tag names (debug aid when a parse finds nothing). */
function tagHistogramOf(node, hist = {}) {
  if (node == null || typeof node !== "object") return hist;
  if (Array.isArray(node)) {
    for (const item of node) tagHistogramOf(item, hist);
    return hist;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("@_")) continue;
    hist[k] = (hist[k] ?? 0) + 1;
    tagHistogramOf(v, hist);
  }
  return hist;
}

/**
 * Expand one ENTSO-E document XML into flat interval records:
 * [{ timestamp: ISO-Z, psrType: string|null, mw: number, ms: interval ms }].
 * Point positions are 1-based; each point covers [ts, ts+resolution).
 * Some documents repeat an interval across periods with different
 * resolutions (e.g. a PT15M period plus a coarser summary period); those
 * duplicates are collapsed per (psrType, timestamp), keeping the record
 * from the finest resolution so energy sums are never double-counted.
 */
export function parseEntsoeIntervals(xml) {
  const doc = parser.parse(xml);
  const series = [...collect(doc, "TimeSeries"), ...collect(doc, "timeSeries")];
  const records = [];
  const seenPsr = new Set();
  // Collapse duplicate (psrType, timestamp) records. Documents can carry
  // each type in more than one TimeSeries copy, grouped in blocks (the
  // platform serves two coexisting published collections per document; see
  // the block tracking below and docs/data-notes.md section 6). Preference
  // order: docStatus A05 (final) over any provisional status, then the higher
  // revisionNumber, then the record from the block with the greater total
  // coverage, then the finer resolution (smaller ms), and on a full tie the
  // FIRST record in document order wins (identical values are a benign
  // duplication). The parser never adjudicates by value.
  const supersedes = (candidate, incumbent) => {
    const candFinal = candidate.docStatus === "A05" ? 1 : 0;
    const incFinal = incumbent.docStatus === "A05" ? 1 : 0;
    if (candFinal !== incFinal) return candFinal > incFinal;
    const candRev = candidate.revisionNumber ?? -1;
    const incRev = incumbent.revisionNumber ?? -1;
    if (candRev !== incRev) return candRev > incRev;
    // Block completeness preference: the record from the block with the
    // greater total coverage wins. Structural, never a value comparison.
    const candCov = candidate.blockCov ?? -1;
    const incCov = incumbent.blockCov ?? -1;
    if (candCov !== incCov) return candCov > incCov;
    if (candidate.ms !== incumbent.ms) return candidate.ms < incumbent.ms;
    return false;
  };
  // Per-psrType copy statistics, computed BEFORE dedup: the platform serves
  // each psrType in more than one TimeSeries copy and the documents carry no
  // docStatus/revisionNumber, so divergent copies would otherwise be resolved
  // silently by document order (docs/data-notes.md section 6, dual-version
  // observation). The parser only reports; it never adjudicates by value.
  const copyBuckets = new Map(); // psr -> { series: [...], keyCounts: Map<ts, {n, mws}> }
  // Blocks: while reading TimeSeries in document order, a repeat of a psrType
  // already seen in the current block starts a new block; every series belongs
  // to exactly one block. Block coverage = the number of distinct timestamps
  // covered by the block, summed over all its series.
  const blocks = []; // { id, psrSet: Set, series: [copy...], coverage }
  let currentBlock = null;
  let copyIndex = 0;
  for (const ts of series) {
    copyIndex += 1;
    const mRID = ts.mRID ?? ts["@_mRID"] ?? null;
    // psrType sits under MktPSRType in the generation responses (a direct child or an
    // attribute in some other document types); accept all shapes.
    const mkt = ts.MktPSRType ?? {};
    const rawPsr = ts["@_psrType"] ?? ts.psrType ?? mkt.psrType ?? mkt["@_psrType"] ?? null;
    const psrType = typeof rawPsr === "string" ? rawPsr : (rawPsr?.["#text"] ?? null);
    if (psrType) seenPsr.add(psrType);
    // Final documents carry docStatus A05; provisional ones carry other codes.
    // revisionNumber sits on the TimeSeries as an attribute in most responses.
    const docStatusRaw = ts.docStatus?.["#text"] ?? ts.docStatus ?? ts["@_docStatus"] ?? null;
    const docStatus = typeof docStatusRaw === "string" ? docStatusRaw : null;
    const revRaw = ts["@_revisionNumber"] ?? ts.revisionNumber ?? null;
    const revisionNumber = Number.isFinite(Number(revRaw)) ? Number(revRaw) : null;
    const psrKey = psrType ?? "(none)";
    if (!currentBlock || currentBlock.psrSet.has(psrKey)) {
      currentBlock = { id: blocks.length + 1, psrSet: new Set(), series: [], coverage: 0 };
      blocks.push(currentBlock);
    }
    currentBlock.psrSet.add(psrKey);
    if (!copyBuckets.has(psrKey)) copyBuckets.set(psrKey, { series: [], keyCounts: new Map() });
    const bucket = copyBuckets.get(psrKey);
    const copy = { index: copyIndex, mRID, block: currentBlock.id, points: 0, byTs: new Map() };
    currentBlock.series.push(copy);
    bucket.series.push(copy);
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
        const record = { timestamp: new Date(tsMs).toISOString(), psrType, mw: qty, ms: resMs, docStatus, revisionNumber, block: copy.block };
        records.push(record);
        copy.points += 1;
        const prevCopy = copy.byTs.get(record.timestamp);
        if (!prevCopy || supersedes(record, prevCopy)) copy.byTs.set(record.timestamp, record);
        const kc = bucket.keyCounts.get(record.timestamp) ?? { n: 0, mws: new Set() };
        kc.n += 1;
        kc.mws.add(record.mw);
        bucket.keyCounts.set(record.timestamp, kc);
      }
    }
  }
  // Block coverage: distinct timestamps per block, summed over all its series;
  // attached to every record so the dedup chain can prefer the more complete
  // block (computed before the merged dedup below).
  for (const b of blocks) b.coverage = b.series.reduce((s, c) => s + c.byTs.size, 0);
  const blockCovById = new Map(blocks.map((b) => [b.id, b.coverage]));
  for (const r of records) r.blockCov = blockCovById.get(r.block) ?? 0;
  // Finalize the per-psrType copy statistics (before the merged dedup below).
  const copies = {};
  for (const [psr, bucket] of copyBuckets) {
    let duplicateKeys = 0;
    let differingKeys = 0;
    for (const kc of bucket.keyCounts.values()) {
      if (kc.n > 1) {
        duplicateKeys += 1;
        if (kc.mws.size > 1) differingKeys += 1;
      }
    }
    copies[psr] = {
      duplicateKeys,
      differingKeys,
      series: bucket.series.map((c) => {
        const recs = [...c.byTs.values()];
        const first = recs.length ? recs.map((r) => r.timestamp).reduce((a, b) => (a < b ? a : b)) : null;
        const last = recs.length ? recs.map((r) => r.timestamp).reduce((a, b) => (a > b ? a : b)) : null;
        const meanMW = recs.length ? recs.reduce((s, r) => s + r.mw, 0) / recs.length : null;
        const energyGWh = recs.reduce((s, r) => s + (r.mw * r.ms) / 3_600_000 / 1000, 0);
        return { index: c.index, mRID: c.mRID, block: c.block, points: c.points, timestamps: c.byTs.size, first, last, meanMW, energyGWh };
      }),
    };
  }
  const deduped = new Map();
  for (const r of records) {
    const key = `${r.psrType ?? ""}|${r.timestamp}`;
    const prev = deduped.get(key);
    if (!prev || supersedes(r, prev)) deduped.set(key, r);
  }
  records.length = 0;
  for (const r of deduped.values()) records.push(r);
  return {
    records,
    psrTypes: [...seenPsr].sort(),
    // Per-psrType copy statistics computed before dedup: for each TimeSeries
    // copy of the type, point count, first/last timestamp, mean MW over the
    // copy's own covered timestamps and energy in GWh; plus per psrType the
    // number of (psrType, timestamp) keys carrying more than one record and
    // how many of those carry differing values.
    copies,
    // Blocks with their coverage (distinct timestamps per block and the
    // per-block series count), so the block preference is auditable.
    blocks: blocks.map((b) => ({ block: b.id, series: b.series.length, coverage: b.coverage })),
    // Debug aid for the probe gate: the response body never contains the
    // token, so a short snippet and a tag histogram are safe to log when
    // nothing was found.
    rootKeys: records.length === 0 ? Object.keys(doc ?? {}) : undefined,
    snippet: records.length === 0 ? String(xml ?? "").slice(0, 2500) : undefined,
    tagHistogram: records.length === 0 ? tagHistogramOf(doc) : undefined,
  };
}

/**
 * Evaluate one A75 attempt of a window against that window's A65 load
 * document. Returns { coverage, ratio, ambiguity, pass, failedChecks }.
 *
 *  1. coverage (reported, never gated): fraction of the window's
 *     load-bearing timestamps that also carry generation data.
 *  2. coherence ratio (the SOLE gated check): total generation energy /
 *     total load energy, computed only over timestamps where generation data
 *     exists (load energy is 0 where the load document has no record).
 *     Accept only within [COHERENCE_RATIO_MIN, COHERENCE_RATIO_MAX].
 *  3. ambiguity (reported as evidence, never gated): for every psrType whose
 *     largest per-copy mean exceeds MATERIALITY_FLOOR_MW, the per-copy means
 *     and their divergence factor. Run 44049087239 proved both published
 *     collections coexist in every document, so divergence is expected and
 *     is not an acceptance signal; the block-completeness preference in the
 *     parser dedup plus the coherence ratio carry the integrity decision.
 */
export function evaluateWindowAttempt(genParsed, loadParsed) {
  const genEnergyMWh = new Map(); // ts -> generation energy in MWh
  for (const r of genParsed.records) {
    genEnergyMWh.set(r.timestamp, (genEnergyMWh.get(r.timestamp) ?? 0) + (r.mw * r.ms) / 3_600_000);
  }
  const loadEnergyMWh = new Map(); // ts -> load energy in MWh
  for (const r of loadParsed.records) {
    loadEnergyMWh.set(r.timestamp, (loadEnergyMWh.get(r.timestamp) ?? 0) + (r.mw * r.ms) / 3_600_000);
  }
  const loadTs = [...loadEnergyMWh.keys()];
  const genTs = [...genEnergyMWh.keys()];
  const genTsSet = new Set(genTs);
  const common = loadTs.filter((ts) => genTsSet.has(ts));
  const coverage = loadTs.length ? common.length / loadTs.length : null;
  let genEnergy = 0;
  let loadEnergy = 0;
  for (const ts of genTs) {
    genEnergy += genEnergyMWh.get(ts);
    loadEnergy += loadEnergyMWh.get(ts) ?? 0;
  }
  const ratio = loadEnergy > 0 ? genEnergy / loadEnergy : null;
  const ambiguity = []; // evidence only, never gated
  for (const [psr, c] of Object.entries(genParsed.copies ?? {})) {
    const means = c.series.map((s) => s.meanMW).filter((m) => Number.isFinite(m));
    if (!means.length) continue;
    const max = Math.max(...means);
    if (max <= INTEGRITY.MATERIALITY_FLOOR_MW) continue;
    const min = Math.min(...means);
    const factor = min > 0 ? max / min : Infinity;
    ambiguity.push({
      psrType: psr,
      name: PSR_TYPES[psr]?.name ?? "UNMAPPED",
      copyMeansMW: means.map((m) => r1(m)),
      largestCopyMeanMW: r1(max),
      smallestCopyMeanMW: r1(min),
      factor: Number.isFinite(factor) ? r1(factor) : "infinite",
    });
  }
  const failedChecks = [];
  if (ratio == null || ratio < INTEGRITY.COHERENCE_RATIO_MIN || ratio > INTEGRITY.COHERENCE_RATIO_MAX) failedChecks.push("coherence");
  return { coverage, ratio, ambiguity, pass: failedChecks.length === 0, failedChecks };
}

/**
 * Fetch the generation (A75) + load (A65) documents over [startUtcMs, endUtcMs) (chunked by year at most)
 * and merge them into one energy-charts-shaped envelope the existing
 * pipeline already consumes:
 *   { data: [{ timestamp: ISO-Z, values: { <site series id>, load,
 *               residual_load, renewable_share_of_generation,
 *               renewable_share_of_load } }] }
 * Series ids match the site vocabulary so
 * slotsFromEnvelopes/daysToTrailing/intensity/records work unchanged; the
 * one exception is B16+B20, which map to distribution_renewables (the TSO's
 * aggregate of distribution-connected renewables), not to a pure solar id.
 * perTypeGWh carries the per-psrType energy (GWh) of the same deduplicated
 * records, so probe criteria and cross-checks derive from one parsed array.
 *
 * Window acceptance guard (fetch integrity, docs/data-notes.md section 6):
 * every window's A75 document is checked for coherence against the window's
 * A65 load document: total generation energy over total load energy, over
 * timestamps with generation data, must sit within 0.6-1.4 (the sole gated
 * check). The parser additionally prefers the more complete TimeSeries block
 * per psrType when deduplicating the two coexisting published collections.
 * A failed attempt re-fetches the A75 document FRESH (bypassing the disk
 * cache, paced as usual), up to INTEGRITY.MAX_WINDOW_ATTEMPTS attempts; the
 * first passing attempt is merged. Copies are never summed and versions are
 * never mixed across retries. If no attempt passes, the window is marked
 * failed and surfaced in the returned windowRecords (full attempts table:
 * per attempt the ratio, per-type copy-divergence evidence, block coverage
 * figures and coverage), so callers can fail legibly. Coverage is reported
 * per attempt but not gated. The returned windowRecords also carry the
 * accepted attempt's per-psrType copy statistics (from parseEntsoeIntervals)
 * for the probe report.
 */
export async function fetchNlPowerEnvelope(startUtcMs, endUtcMs, { fresh = false } = {}) {
  const windows = entsoeWindows(startUtcMs, endUtcMs);
  const byTs = new Map(); // ISO ts -> { values: Record<string, number>, renMW, totalMW, loadMW, ms }
  const psrSeen = new Set();
  const perTypeGWh = {}; // psrType -> energy in GWh, from the same deduplicated records
  const windowRecords = []; // per-window acceptance-guard records for the probe
  let failures = 0;

  for (const w of windows) {
    // The load document is fetched once per window; the guard evaluates every
    // A75 attempt against it.
    const load = await fetchEntsoe({ documentType: DOC_LOAD, ...w }, { fresh, label: `${DOC_LOAD} ${w.periodStart}-${w.periodEnd}` });
    if (!load.ok) {
      failures += 1;
      windowRecords.push({ window: w, attempts: [], acceptedAttempt: null, coverage: null, copies: null, failed: true, reason: `A65 fetch failed: ${load.error?.message ?? load.error}` });
      console.warn(`  ENTSO-E ${DOC_LOAD} ${w.periodStart}-${w.periodEnd} FAILED: ${load.error?.message ?? load.error}`);
      continue;
    }
    const loadParsed = parseEntsoeIntervals(load.xml);
    if (loadParsed.records.length === 0) {
      console.warn(`  ENTSO-E ${DOC_LOAD} ${w.periodStart}-${w.periodEnd} returned no timeSeries; tags: ${JSON.stringify(loadParsed.tagHistogram)}; body starts: ${loadParsed.snippet}`);
    }

    const attempts = [];
    let accepted = null;
    for (let attempt = 1; attempt <= INTEGRITY.MAX_WINDOW_ATTEMPTS; attempt++) {
      // Retries always bypass the disk cache: a cached defective document can
      // never be re-accepted. Attempt 1 honours the caller's `fresh` flag.
      const gen = await fetchEntsoe(
        { documentType: DOC_GENERATION, ...w },
        { fresh: attempt === 1 ? fresh : true, label: `${DOC_GENERATION} ${w.periodStart}-${w.periodEnd}${attempt > 1 ? ` (integrity attempt ${attempt})` : ""}` },
      );
      if (!gen.ok) {
        attempts.push({ attempt, fromCache: false, fetchError: String(gen.error?.message ?? gen.error), coverage: null, coherenceRatio: null, ambiguity: [], pass: false, failedChecks: ["fetch"] });
        console.warn(`  ENTSO-E ${DOC_GENERATION} ${w.periodStart}-${w.periodEnd} attempt ${attempt} FAILED: ${gen.error?.message ?? gen.error}`);
        continue;
      }
      const genParsed = parseEntsoeIntervals(gen.xml);
      if (genParsed.records.length === 0) {
        console.warn(`  ENTSO-E ${DOC_GENERATION} ${w.periodStart}-${w.periodEnd} attempt ${attempt} returned no timeSeries; tags: ${JSON.stringify(genParsed.tagHistogram)}; body starts: ${genParsed.snippet}`);
      }
      const evaluation = evaluateWindowAttempt(genParsed, loadParsed);
      attempts.push({
        attempt,
        fromCache: gen.fromCache,
        coverage: evaluation.coverage != null ? r3(evaluation.coverage) : null,
        coherenceRatio: evaluation.ratio != null ? r3(evaluation.ratio) : null,
        // Evidence figures, never gated: per-copy divergence above the
        // materiality floor, the duplicate-key counts, and the block coverage
        // figures the parser's block preference computed.
        ambiguity: evaluation.ambiguity,
        duplicateKeys: Object.fromEntries(Object.entries(genParsed.copies ?? {}).map(([psr, c]) => [psr, { duplicateKeys: c.duplicateKeys, differingKeys: c.differingKeys }])),
        blocks: genParsed.blocks,
        blockCoverageTotal: (genParsed.blocks ?? []).reduce((s, b) => s + b.coverage, 0),
        pass: evaluation.pass,
        failedChecks: evaluation.failedChecks,
      });
      if (evaluation.pass) {
        accepted = genParsed;
        break;
      }
      console.warn(
        `  ENTSO-E ${DOC_GENERATION} ${w.periodStart}-${w.periodEnd} attempt ${attempt} rejected (${evaluation.failedChecks.join("+")}): ` +
        `coherence ratio ${evaluation.ratio != null ? r3(evaluation.ratio) : "n/a"} (band ${INTEGRITY.COHERENCE_RATIO_MIN}-${INTEGRITY.COHERENCE_RATIO_MAX}); ` +
        `per-copy divergence (evidence): ${evaluation.ambiguity.length ? evaluation.ambiguity.map((x) => `${x.psrType} factor ${x.factor}`).join(", ") : "none"}; ` +
        (attempt < INTEGRITY.MAX_WINDOW_ATTEMPTS ? "re-fetching fresh" : "no attempts left"),
      );
    }
    const acceptedAttempt = accepted ? attempts.findIndex((a) => a.pass) + 1 : null;
    windowRecords.push({
      window: w,
      attempts,
      acceptedAttempt,
      coverage: acceptedAttempt ? attempts[acceptedAttempt - 1].coverage : null,
      copies: accepted ? accepted.copies : null,
      failed: !accepted,
      reason: accepted ? null : `no A75 attempt passed the window coherence check after ${attempts.length} attempt(s) (generation/load energy ratio band ${INTEGRITY.COHERENCE_RATIO_MIN}-${INTEGRITY.COHERENCE_RATIO_MAX} over timestamps with generation data)`,
    });
    if (!accepted) {
      failures += 1;
      console.warn(
        `  ENTSO-E ${DOC_GENERATION} window ${w.periodStart}-${w.periodEnd} FAILED the coherence check: ` +
        attempts.map((a) => `attempt ${a.attempt}: ratio ${a.coherenceRatio ?? "n/a"}, coverage ${a.coverage ?? "n/a"}, blockCoverageTotal ${a.blockCoverageTotal ?? "n/a"}`).join("; "),
      );
      continue;
    }
    for (const p of accepted.psrTypes) psrSeen.add(p);
    for (const r of accepted.records) {
      const psr = PSR_TYPES[r.psrType];
      const seriesId = psr?.series ?? "others";
      perTypeGWh[r.psrType ?? "(none)"] = (perTypeGWh[r.psrType ?? "(none)"] ?? 0) + (r.mw * r.ms) / 3_600_000 / 1000;
      const rec = byTs.get(r.timestamp) ?? { values: {}, renMW: 0, totalMW: 0, loadMW: null, ms: 0 };
      rec.values[seriesId] = (rec.values[seriesId] ?? 0) + r.mw;
      rec.totalMW += r.mw;
      rec.ms = rec.ms || r.ms;
      if (psr?.renewable) rec.renMW += r.mw;
      byTs.set(r.timestamp, rec);
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
        // per-type feeds): load - wind onshore - wind offshore -
        // distribution-connected renewables (the renamed B16+B20 aggregate).
        const ws = (v.wind_onshore ?? 0) + (v.wind_offshore ?? 0) + (v.distribution_renewables ?? 0);
        v.residual_load = rec.loadMW - ws;
      }
      return { timestamp: ts, values: v, ms: rec.ms };
    });

  return {
    ok: failures === 0,
    failures,
    envelope: { data },
    psrTypes: [...psrSeen].sort(),
    perTypeGWh,
    windows,
    // Per-window acceptance-guard records: per attempt the coherence ratio,
    // per-type ambiguity findings, coverage and pass/fail, the accepted
    // attempt index, and the accepted attempt's per-psrType copy statistics
    // (so the probe can print both published versions when they coexist).
    windowRecords,
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
