import type { Metadata, Viewport } from "next";
import { preinit } from "react-dom";
import "./globals.css";
import { FAMILY } from "@/family";
import { themeInitScriptSrc } from "@/theme";

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
  /*
    Theme bootstrap: React Float hoists this into the initial HTML <head> as
    a <script src>, so it runs before first paint (no flash of the wrong
    theme) without rendering a <script> element in the React tree — such an
    element is never executed when React client-renders, which is what the
    dev console warning was about. The switcher also re-applies the stored
    theme on mount as a backstop.
  */
  preinit(themeInitScriptSrc, { as: "script" });

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
