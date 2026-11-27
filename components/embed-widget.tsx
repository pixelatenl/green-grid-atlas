"use client";

/*
  The embed section body: the iframe snippet in a code box with a copy
  button, next to a preview of the widget itself. The snippet is built
  from FAMILY.siteUrl so it always points at the canonical production
  URL; the preview loads the same-origin /widget page, which renders
  from /data/snapshot.json. Copy uses the Clipboard API, with a legacy
  textarea fallback for contexts where clipboard access is denied.
*/

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { FAMILY } from "@/family";

/*
  One attribute per line so the box reads well on narrow screens; the
  newlines are valid inside the tag, and copying takes the text as
  displayed.
*/
const SNIPPET = `<iframe
  src="${FAMILY.siteUrl}/widget"
  width="420"
  height="260"
></iframe>`;

export function EmbedWidget() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(SNIPPET);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = SNIPPET;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="grid grid-cols-2 items-start gap-6">
      <div className="min-w-0">
        <p className="gg-label text-muted-foreground">Iframe snippet</p>
        <div className="relative mt-2">
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-4 pr-14 font-mono text-xs leading-relaxed">
            <code>{SNIPPET}</code>
          </pre>
          <button
            type="button"
            onClick={copySnippet}
            aria-label={copied ? "Snippet copied to clipboard" : "Copy iframe snippet"}
            title={copied ? "Copied" : "Copy"}
            className="absolute right-2 top-2 cursor-pointer rounded-md border border-border bg-card p-1.5 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {copied ? (
              <Check aria-hidden="true" className="size-4" />
            ) : (
              <Copy aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>
      </div>
      <div className="min-w-0">
        <p className="gg-label text-muted-foreground">Preview</p>
        <iframe
          src="/widget"
          title="Preview of the Green Grid Atlas widget at /widget"
          height={260}
          loading="lazy"
          className="mt-2 block w-full rounded-lg border border-border"
        />
      </div>
    </div>
  );
}
