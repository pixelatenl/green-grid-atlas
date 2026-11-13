/*
  Paced, cached, retrying fetch layer shared by backfill.mjs and
  snapshot.mjs. Implements the pacing rule verified in docs/data-notes.md
  (Phase 0 item 4):

  - one request at a time, never concurrent;
  - minimum 31 s between requests to the same API endpoint (the documented
    token bucket is 2 requests/minute for /price and by default for the
    other endpoints, burst 2-4; sustained safe spacing is one request per
    ~30 s per endpoint), enforced by a per-endpoint timer;
  - on HTTP 429: wait Retry-After (header, seconds; fallback 20) times the
    attempt number, capped at 120 s, up to 6 attempts;
  - on other failures: backoff 5 s x attempt;
  - successful responses are cached on disk (scripts/.cache, gitignored)
    so re-runs never re-hit the API; pass fresh:true to bypass the read.

  Open-Meteo is paced separately at >= 2 s between requests (its published
  free limit is 10,000 calls/day).
*/

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, ".cache");

export const EC_BASE = "https://api.energy-charts.info";
export const OM_BASE = "https://archive-api.open-meteo.com";

const MIN_SPACING_MS = 31_000; // per endpoint path
const OM_MIN_SPACING_MS = 2_000;
const MAX_ATTEMPTS = 6;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const lastAt = new Map(); // endpoint key -> ms timestamp of last request

async function ensureMinSpacing(key, minMs) {
  const last = lastAt.get(key) ?? 0;
  const wait = last + minMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt.set(key, Date.now());
}

async function readCache(cacheKey) {
  try {
    return await readFile(path.join(CACHE_DIR, cacheKey + ".json"), "utf8");
  } catch {
    return null;
  }
}

async function writeCache(cacheKey, body) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, cacheKey + ".json"), body, "utf8");
}

/**
 * Fetch JSON with pacing, retries and disk cache.
 * Returns { ok: true, json, fromCache, status } or { ok: false, error, status }.
 * Never throws: a failed non-critical fetch degrades gracefully.
 */
export async function fetchJsonPaced(url, { fresh = false, minSpacingMs = MIN_SPACING_MS, label = url } = {}) {
  const endpointKey = new URL(url).pathname;
  const cacheKey = createHash("sha1").update(url).digest("hex");
  if (!fresh) {
    const cached = await readCache(cacheKey);
    if (cached != null) {
      try {
        return { ok: true, json: JSON.parse(cached), fromCache: true, status: 200 };
      } catch {
        // corrupted cache entry: fall through and re-fetch
      }
    }
  }
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await ensureMinSpacing(endpointKey, minSpacingMs);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(120_000),
      });
      if (response.status === 429) {
        const ra = Number(response.headers.get("retry-after")) || 20;
        const wait = Math.min(ra * attempt, 120_000);
        lastError = new Error(`HTTP 429 for ${label} (retry-after ${ra}s)`);
        console.warn(`  429 on ${label}, waiting ${Math.round(wait / 1000)}s (attempt ${attempt})`);
        await sleep(wait);
        continue;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${label}`);
      }
      const body = await response.text();
      await writeCache(cacheKey, body);
      return { ok: true, json: JSON.parse(body), fromCache: false, status: response.status };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const wait = 5_000 * attempt;
        console.warn(`  ${String(error.message ?? error)} on ${label}, retrying in ${wait / 1000}s (attempt ${attempt})`);
        await sleep(wait);
      }
    }
  }
  return { ok: false, error: lastError, status: null };
}

/** energy-charts v2 endpoint helper. */
export function ecUrl(pathname, params) {
  const url = new URL(EC_BASE + pathname);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** Open-Meteo archive helper, paced at 2 s. */
export async function fetchOpenMeteo(params, opts = {}) {
  const url = new URL(OM_BASE + "/v1/archive");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return fetchJsonPaced(url.toString(), { minSpacingMs: OM_MIN_SPACING_MS, label: url.pathname + "?" + url.searchParams, ...opts });
}

/** Clear the per-endpoint timer (used by tests; not needed between processes). */
export function _resetTimers() {
  lastAt.clear();
}
