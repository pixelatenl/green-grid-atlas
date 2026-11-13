/**
 * Family configuration contract for the Pixelate Open Data Project
 * family. Every product supplies its own values; the family
 * components (header, footer) read them from a FAMILY constant on the
 * "@/family" import path, so a product installs this file once and
 * fills in its own values below.
 */
export type FamilyConfig = {
  /** Organization behind the family, linked from the footer colophon. */
  organization: string;
  organizationUrl: string;
  /** Display name of this product, rendered by the header and the footer signature. */
  productName: string;
  /** Short site name used for og:site_name. */
  siteName: string;
  /**
   * Canonical production URL of this product site. The canonical meta
   * tag, the Open Graph URL and the crawl files all resolve against
   * it, so a domain move is a one-place change here.
   */
  siteUrl: string;
  /**
   * Launcher website of the Open Data Project, which gathers all the
   * open data projects; the family header and footer link to it.
   */
  launcherUrl: string;
  launcherLabel: string;
  /**
   * Source repository of this product, linked from the shared family
   * footer so the site points at the code that builds it.
   */
  sourceUrl: string;
};

/**
 * This product's family configuration. Replace every placeholder
 * value with this product's own; see examples/family-config.example.ts
 * in the open-data-family registry for a filled-in configuration.
 */
export const FAMILY: FamilyConfig = {
  organization: "Pixelate BV",
  organizationUrl: "https://pixelate.nl",
  productName: "Green Grid Atlas",
  siteName: "grid-atlas.pixelate.nl",
  siteUrl: "https://grid-atlas.pixelate.nl",
  launcherUrl: "https://opendata.pixelate.nl/",
  launcherLabel: "Open Data Project",
  sourceUrl: "https://github.com/pixelatenl/green-grid-atlas",
};
