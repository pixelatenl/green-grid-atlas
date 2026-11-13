import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { FAMILY } from "@/family";
import { themeInitScript } from "@/theme";

/*
  Root layout: the theme bootstrap (no flash of the wrong theme) and the
  shared document shell. The family header/footer live in the (site) route
  group's layout, so /widget renders without them.
*/
export const metadata: Metadata = {
  metadataBase: new URL(FAMILY.siteUrl),
  authors: [{ name: FAMILY.organization, url: FAMILY.organizationUrl }],
};

/*
  Theme colors mirror the --background tokens in globals.css:
  #eaf6f9 for light, #0f353d for dark.
*/
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eaf6f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f353d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          beforeInteractive inline script: injected into the initial HTML
          head by Next (not rendered by React on the client, so no script
          warning), still before first paint so there is no theme flash.
        */}
        <Script
          id="odp-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
