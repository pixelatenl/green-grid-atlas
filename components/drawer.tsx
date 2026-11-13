"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type DrawerProps = {
  /** Trigger text, styled to match the other footer links. */
  label: string;
  /** Panel title; the dialog is labelled by it. */
  title: string;
  /** Optional lead sentence under the panel title. */
  description?: string;
  /**
   * Panel body. The panel stays mounted (hidden plus inert when
   * closed), so this content ships in the static HTML even while
   * the drawer is shut.
   */
  children: React.ReactNode;
};

/**
 * Right-side drawer, opened by a footer-styled trigger link. A plain
 * client component: no animation library, no Radix. Escape, the
 * overlay, and the close button close it; focus is trapped inside
 * while open. Tailwind v4 translates via the CSS translate property,
 * so the slide-out completion listens for that transition name.
 */
export function Drawer({ label, title, description, children }: DrawerProps) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const panelId = useId();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // While open: lock body scroll, close on Escape, and move focus
  // into the panel. Cleanup runs on close and on unmount.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDrawer();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Slide the panel in one frame after the hidden attribute comes
  // off, so the transform transition has a starting style to run
  // from; without the extra frame the panel would appear in place.
  useEffect(() => {
    if (!open) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [open]);

  function openDrawer() {
    if (open) {
      // Re-open request while the slide-out is still running:
      // reverse it instead of ignoring it.
      setShown(true);
      return;
    }
    setOpen(true);
  }

  function closeDrawer() {
    setShown(false);
    triggerRef.current?.focus();
  }

  // Manual focus trap: Tab and Shift+Tab wrap inside the panel.
  function handleTab(event: React.KeyboardEvent) {
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDrawer}
        aria-expanded={open}
        aria-controls={panelId}
        className="cursor-pointer text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        {label}
      </button>

      <div
        hidden={!open}
        inert={!open}
        aria-hidden={!open}
        onClick={closeDrawer}
        className={cn(
          "fixed inset-0 z-[60] bg-black/50 transition-opacity duration-200",
          shown ? "opacity-100" : "opacity-0",
        )}
      />

      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        hidden={!open}
        inert={!open}
        aria-hidden={!open}
        tabIndex={-1}
        onKeyDown={handleTab}
        onTransitionEnd={(event) => {
          // The slide-out finished: give the panel back its hidden
          // state. Interrupted transitions never reach this branch.
          if (
            event.target === panelRef.current &&
            (event.propertyName === "translate" ||
              event.propertyName === "transform") &&
            !shown
          ) {
            setOpen(false);
          }
        }}
        className={cn(
          "fixed inset-y-0 right-0 z-[60] flex w-[480px] max-w-[90vw] flex-col border-l border-border bg-card shadow-xl transition-transform duration-300 ease-in-out",
          shown ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-6">
          <div>
            <h2 id={titleId} className="text-xl font-semibold tracking-tight">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={closeDrawer}
            aria-label="Close"
            className="shrink-0 cursor-pointer rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <svg
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-6">{children}</div>
      </div>
    </>
  );
}
