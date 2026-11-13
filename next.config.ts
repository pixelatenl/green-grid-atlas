import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static export, uploaded to the shared Apache host alongside
  // pixelate.nl. Data is embedded at build time from the committed snapshot.
  output: "export",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
