"use client";

/*
  The rhythm grids' tooltip: a thin wrapper over the one shared
  ChartTooltip island (components/chart-tooltip.tsx), in cursor mode so
  the atlas grids render pixel-comparable to the approved layout. The
  grid cells carry the generic attribute-mode trigger contract
  (data-tip-heading / data-tip-title / data-tip-value /
  data-tip-qualifier); no private tooltip logic remains here.

  pan is false because the grids sit inside horizontally scrollable
  containers: their touch-action stays auto so a horizontal touch-drag
  still scrolls the grid, while a vertical drag scrolls the page.
*/

import { ChartTooltip } from "@/components/chart-tooltip";

export function RhythmTooltip({ children }: { children: React.ReactNode }) {
  return (
    <ChartTooltip cursor pan={false}>
      {children}
    </ChartTooltip>
  );
}
