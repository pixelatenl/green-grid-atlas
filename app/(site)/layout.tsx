import type { Metadata } from "next";
import { FamilyHeader } from "@/components/family-header";
import { SiteFooter } from "@/components/site-footer";
import { FAMILY } from "@/family";
import { snapshot, formatNumber } from "@/data/snapshot";
import { formatBand } from "@/grid/green-window";

/*
  The (site) group layout: family header and footer plus all site metadata
  derived at build time from the committed snapshot, so the numbers in the
  meta tags can never go stale between daily rebuilds. The description
  carries the current green window, formatted exactly as the page renders it.
*/
const band = snapshot.greenWindow.green.modalBand;
const GREEN_WINDOW_TEXT = band
  ? `The green window — the recurring cheap-and-clean hours — is currently ${formatBand(band)}, on ${formatNumber(snapshot.greenWindow.green.frequencyShare * 100, 0)}% of the trailing ${snapshot.greenWindow.green.days} days.`
  : "The recurring cheap-and-clean hours of the Dutch grid, computed daily from open data.";

const SITE_TITLE = `${FAMILY.productName} | ${FAMILY.organization}`;
const SITE_DESCRIPTION = `When is the greenest hour on the Dutch grid? ${GREEN_WINDOW_TEXT} Hour-by-day atlas of price, renewable share and computed carbon intensity since ${snapshot.composites.years[0]?.year}, from energy-charts.info (CC BY 4.0) and Open-Meteo.`;

const OG_IMAGE_ALT = `The ${FAMILY.productName} in the Pixelate family's display style: the product name, its question, and the open-data credits.`;

export const metadata: Metadata = {
  title: {
    default: SITE_TITLE,
    template: `%s | ${FAMILY.productName}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "Dutch electricity grid",
    "day-ahead price Netherlands",
    "renewable share",
    "carbon intensity",
    "energy-charts",
    "open data",
    "green window",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: "website",
    siteName: FAMILY.siteName,
    url: "/",
    locale: "en",
    images: [{ url: "/images/og.png", width: 1200, height: 630, alt: OG_IMAGE_ALT }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/images/og.png"],
  },
  robots: { index: true, follow: true },
};

/*
  Structured data: one Dataset node for the aggregates behind the page
  (CC BY 4.0, Pixelate BV creator, dateModified from the snapshot's
  retrievedAt) and a minimal WebSite node.
*/
const datasetJsonLd = {
  "@context": "https://schema.org",
  "@type": "Dataset",
  name: "Dutch grid aggregates from energy-charts.info (Fraunhofer ISE) and Open-Meteo open data",
  description: SITE_DESCRIPTION,
  url: FAMILY.siteUrl,
  isAccessibleForFree: true,
  license: "https://creativecommons.org/licenses/by/4.0/",
  creator: { "@type": "Organization", name: FAMILY.organization, url: FAMILY.organizationUrl },
  provider: {
    "@type": "Organization",
    name: "energy-charts.info (Fraunhofer ISE); day-ahead prices: Bundesnetzagentur | SMARD.de; weather: Open-Meteo",
    url: "https://energy-charts.info",
  },
  sameAs: FAMILY.sourceUrl,
  dateModified: snapshot.retrievedAt,
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: FAMILY.productName,
  url: FAMILY.siteUrl,
};

export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />
      <div className="flex min-h-screen flex-col">
        <FamilyHeader productName={FAMILY.productName} />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </div>
    </>
  );
}
