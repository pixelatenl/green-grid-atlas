import type { Metadata } from "next";
import { FAMILY } from "@/family";

/*
  Widget layout metadata: the embed page is noindex; its canonical URL is the
  main page. The widget renders without the family header and footer.
*/
export const metadata: Metadata = {
  title: `${FAMILY.productName} — widget`,
  description:
    "Embeddable widget: the NL green window and tomorrow's day-ahead price shape, snapshot-fresh daily from the Green Grid Atlas. Never live.",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function WidgetLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
