import Link from "next/link";
import { FAMILY } from "@/family";

/** Shared uppercase zone label of the footer credits and colophon. */
const zoneLabel = "text-xs font-semibold tracking-widest text-muted-foreground uppercase";

/** Underline-offset hover pattern shared by the footer text links. */
const footerLink = "text-muted-foreground underline underline-offset-4 hover:text-foreground";

/**
 * Three zones: the signature (product name, anchored to the launcher
 * hub), the credits (data attribution) and the colophon (source and
 * organization links). The credits prop is required: the data
 * attribution is product content in its entirety, so the product
 * supplies it as a node. The optional extra prop lets a product slot
 * a link into the colophon, after the repository and organization
 * links. The optional disclaimer prop seats the disclaimer drawer in
 * the same group; products without one render as before.
 */
export function FamilyFooter({
  credits,
  extra,
  disclaimer,
}: {
  /** Data attribution of the credits zone, supplied by the product. */
  credits: React.ReactNode;
  extra?: React.ReactNode;
  disclaimer?: React.ReactNode;
}) {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-[1536px] px-4 py-10 sm:px-6 lg:py-12">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
          {/*
            Signature. The product name is the anchor back to the
            launcher hub, with the family phrase as its muted caption.
          */}
          <div className="max-w-xl">
            <Link
              href={FAMILY.launcherUrl}
              className="text-lg font-extrabold tracking-tight text-foreground"
            >
              {FAMILY.productName}
            </Link>
            <p className="mt-1 text-sm text-muted-foreground">
              Part of the{" "}
              <Link href={FAMILY.launcherUrl} className={footerLink}>
                {FAMILY.launcherLabel}
              </Link>
            </p>
          </div>
          {/*
            Right-hand zones. Colophon first on phones, credits first on
            wide screens, with a hairline divider between the two.
          */}
          <div className="flex flex-col-reverse gap-8 lg:flex-row lg:items-start lg:gap-10">
            <div className="max-w-xl">
              <p className={zoneLabel}>Data</p>
              <div className="mt-2 text-sm leading-snug text-muted-foreground">
                {credits}
              </div>
            </div>
            <div className="max-w-xl lg:border-l lg:border-border lg:pl-10">
              <p className={zoneLabel}>Colophon</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <Link href={FAMILY.sourceUrl} className={footerLink}>
                  GitHub
                </Link>
                <Link href={FAMILY.organizationUrl} className={footerLink}>
                  {FAMILY.organization}
                </Link>
                {disclaimer}
                {extra}
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
