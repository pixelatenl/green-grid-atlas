/*
  One-off cross-zone solar audit for the ENTSO-E NL PR (never part of the
  daily snapshot job, never wired into a scheduled workflow):

    node --experimental-strip-types scripts/audit-zones.mjs

  For each of the 36 score zones it fetches, from the energy-charts public
  API (keyless), the public_power feed for the summer sample day 2026-06-15
  and the latest installed_power record, and computes the observed solar
  peak (MW) as a share of the installed solar AC capacity (GW, solar_ac).
  Expected: every zone shows a peak share in the tens of percent; a broken
  feed shows about 1 percent (the pre-fix NL did). Results are printed as a
  markdown table for the PR description and cached on disk. energy-charts
  is paced at one request per ~31 s per endpoint (2 requests/minute per
  endpoint), so the 72 requests take roughly twenty minutes; the two
  endpoints pace independently and are alternated per zone.
*/

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ecUrl, fetchJsonPaced } from "./lib-fetch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_DAY = "2026-06-15";

async function main() {
  const now = new Date().toISOString();
  // The 36 score zones as recorded in the committed snapshot.
  const snapshot = JSON.parse(await readFile(path.join(HERE, "..", "public", "data", "snapshot.json"), "utf8"));
  const zones = snapshot.scores.countries.map((c) => c.country).sort();
  console.log(`Auditing ${zones.length} score zones on sample day ${SAMPLE_DAY}`);
  const rows = [];
  for (const zone of zones) {
    const power = await fetchJsonPaced(
      ecUrl("/v2/public_power", { country: zone, start: SAMPLE_DAY, end: SAMPLE_DAY }),
      { label: `public_power ${zone} ${SAMPLE_DAY}` },
    );
    const inst = await fetchJsonPaced(ecUrl("/v2/installed_power", { country: zone, year: "-1" }), {
      label: `installed_power ${zone}`,
    });
    let peakMW = null;
    if (power.ok) {
      for (const rec of power.json.data ?? []) {
        const s = rec.values?.solar;
        if (s != null && Number.isFinite(s) && (peakMW == null || s > peakMW)) peakMW = s;
      }
    }
    let installedGW = null;
    if (inst.ok) {
      const last = inst.json.data?.[inst.json.data.length - 1];
      installedGW = last?.values?.solar_ac ?? null;
    }
    const share = peakMW != null && installedGW != null && installedGW > 0 ? (peakMW / 1000 / installedGW) * 100 : null;
    rows.push({ zone, peakMW, installedGW, sharePct: share != null ? Math.round(share * 10) / 10 : null, powerOk: power.ok, instOk: inst.ok });
    console.log(`${zone}  peak ${peakMW ?? "n/a"} MW  installed ${installedGW ?? "n/a"} GW  share ${rows[rows.length - 1].sharePct ?? "n/a"}%`);
  }
  const report = { auditedAt: now, sampleDay: SAMPLE_DAY, rows };
  console.log("\n| zone | solar peak 2026-06-15 (MW) | installed solar AC (GW) | peak share of installed |");
  console.log("| --- | --- | --- | --- |");
  for (const r of rows) {
    console.log(`| ${r.zone} | ${r.peakMW ?? "n/a"} | ${r.installedGW ?? "n/a"} | ${r.sharePct != null ? `${r.sharePct}%` : "n/a"} |`);
  }
  const failing = rows.filter((r) => r.sharePct != null && r.sharePct < 10);
  console.log(`\nzones below a 10% peak share (suspect feeds): ${failing.length ? failing.map((r) => r.zone).join(", ") : "none"}`);
  await mkdir(path.join(HERE, ".cache"), { recursive: true });
  await writeFile(path.join(HERE, ".cache", `zone-audit-${now.slice(0, 10)}.json`), JSON.stringify(report, null, 2), "utf8");
  console.log(`Wrote audit report to scripts/.cache/zone-audit-${now.slice(0, 10)}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
