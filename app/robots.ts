import type { MetadataRoute } from "next";
import { FAMILY } from "@/family";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/widget",
    },
    sitemap: `${FAMILY.siteUrl}/sitemap.xml`,
  };
}
