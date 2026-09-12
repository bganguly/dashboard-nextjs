import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // required for Docker / Cloud Run
};

export default nextConfig;
