import { snapshot } from "./snapshot";
import { contextSignatures } from "@/grid/narrate-context";

/*
  Server-side narration accessor (node:crypto lives here, never in the
  client bundle). A stored narration renders only when its stored SHA-256
  signature still matches the context computed from the snapshot being
  rendered — signature-gated at build time, same code path as the run.
*/
export function narrationFor(key: string): string | null {
  const text = snapshot.narration?.visuals?.[key];
  if (!text) return null;
  const current = contextSignatures(snapshot)[key];
  if (!current || snapshot.narration?.signatures?.[key] !== current) return null;
  return text;
}
