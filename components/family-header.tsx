import Link from "next/link";
import { FAMILY } from "@/family";
import { FamilyLogo } from "@/components/family-logo";
import { ThemeSwitcher } from "@/components/theme-switcher";

/**
 * Shared family header, present on every product site in the family.
 * Carries the family mark and the back link to the launcher hub.
 * The product name is a required prop: it is the one per-product value
 * the header renders.
 */
export function FamilyHeader({ productName }: { productName: string }) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1536px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link
            href={FAMILY.launcherUrl}
            className="flex items-center gap-2 font-semibold tracking-tight"
            title="Open Data Project"
          >
            <FamilyLogo />
            {FAMILY.launcherLabel}
          </Link>
          <span className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
          <span className="hidden text-sm text-muted-foreground sm:block">
            {productName}
          </span>
        </div>
        <nav className="flex items-center gap-1" aria-label="Site">
          <ThemeSwitcher />
        </nav>
      </div>
    </header>
  );
}
