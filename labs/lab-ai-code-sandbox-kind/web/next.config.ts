import type { NextConfig } from "next";

// agentRules: false stops `next dev` from writing agent rule files into the
// app folder.
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
};

export default config;
