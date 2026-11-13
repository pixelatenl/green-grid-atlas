/*
  Narration step of the snapshot run: one "AI insight" paragraph per
  narrated visual, generated at snapshot time by Mistral from the same
  aggregates that power the page (src/grid/narrate-context.ts). The recorded
  family pattern: deterministic code computes every figure and builds the
  context, the model only narrates that context, and the site renders the
  narration verbatim as static text.

  Discipline: mistral-small-latest, temperature 0.2, numerals-only guidance,
  prose-ratio lint, every numeral in the returned text must appear in the
  context figures, at most two calls per visual, hard cap 16 calls per run,
  fail-soft (a failed visual simply stays hidden). Key from
  process.env.MISTRAL_API_KEY only — never logged, never written to disk.
*/

import {
  buildContexts,
  contextSignature,
  NARRATED_VISUALS,
} from "../src/grid/narrate-context.ts";

const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODEL = "mistral-small-latest";
const TEMPERATURE = 0.2;
const MAX_TOKENS = 160;
const MAX_CALLS_PER_VISUAL = 2;
const MAX_CALLS_PER_RUN = 16;

const SYSTEM_PROMPT = [
  "You write the 'AI insight' caption of a public data-visualization page.",
  "Plain English, at most two sentences.",
  "Tell the visitor what is on the screen and the single most notable thing about it.",
  "Use only figures that appear in the provided context; never introduce a number that is not in the context.",
  "State every share and comparison as a percentage with a numeral taken from the context (for example '17.0%'); never as a prose ratio.",
  "No markdown, no lists, no hedging (never write 'approximately', 'around', 'seems', or 'likely').",
  "Output only the insight text.",
].join(" ");

const NUMERALS_GUIDANCE =
  "Guidance: state every share and comparison as a percentage with a numeral taken from the context figures (for example '17.0%'); prose ratios such as 'one in twelve', 'six out of ten', or 'two in five' are not permitted.";

/* Prose-ratio lint: "one in twelve", "two out of five", "three in ten"... */
const PROSE_RATIO =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(in|out of)\s+(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand)\b/i;

function numeralsIn(text) {
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => m[0]);
}

/** Every numeral in the narration must be one of the context figures. */
function validate(text, context) {
  if (PROSE_RATIO.test(text)) return "prose ratio";
  const allowed = new Set(Object.values(context.figures).join(" ").match(/-?\d+(?:\.\d+)?/g) ?? []);
  // Also allow numerals that are substrings of a figure (e.g. "30" inside "30.5").
  for (const n of numeralsIn(text)) {
    if (allowed.has(n)) continue;
    const ok = [...allowed].some((a) => a.includes(n));
    if (!ok) return `unknown numeral ${n}`;
  }
  return null;
}

async function callMistral(context) {
  const user = [
    `Visual: ${context.title}`,
    `What it shows: ${context.shows}`,
    `Context figures (the only figures you may use):`,
    ...Object.entries(context.figures).map(([k, v]) => `- ${k}: ${v}`),
    NUMERALS_GUIDANCE,
  ].join("\n");
  const response = await fetch(MISTRAL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Mistral HTTP ${response.status}`);
  const json = await response.json();
  return String(json.choices?.[0]?.message?.content ?? "").trim();
}

/**
 * Narrate the visuals of a snapshot object (mutates and returns its
 * `narration` field). Fail-soft: any error leaves the visual un-narrated.
 */
export async function narrate(snapshot) {
  if (!process.env.MISTRAL_API_KEY) {
    console.log("  narration: MISTRAL_API_KEY absent, skipping (fail-soft)");
    return snapshot.narration ?? { signatures: {}, visuals: {} };
  }
  const contexts = buildContexts(snapshot);
  const signatures = {};
  const visuals = { ...(snapshot.narration?.visuals ?? {}) };
  let calls = 0;
  for (const key of NARRATED_VISUALS) {
    const context = contexts[key];
    const signature = contextSignature(context);
    signatures[key] = signature;
    if (snapshot.narration?.signatures?.[key] === signature && visuals[key]) continue;
    let done = false;
    for (let attempt = 0; attempt < MAX_CALLS_PER_VISUAL && !done; attempt++) {
      if (calls >= MAX_CALLS_PER_RUN) break;
      calls += 1;
      try {
        const text = await callMistral(context);
        const problem = text ? validate(text, context) : "empty response";
        if (problem) {
          console.warn(`  narration ${key}: rejected (${problem}) on attempt ${attempt + 1}`);
          continue;
        }
        visuals[key] = text;
        done = true;
      } catch (error) {
        console.warn(`  narration ${key}: call failed (${error.message ?? error})`);
      }
    }
    if (!done) delete visuals[key];
  }
  console.log(`  narration: ${Object.keys(visuals).length}/${NARRATED_VISUALS.length} visuals, ${calls} API calls`);
  return { signatures, visuals };
}
