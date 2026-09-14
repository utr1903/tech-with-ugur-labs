import type { NextConfig } from "next";

// agentRules disabled: `next dev` otherwise (re)writes AGENTS.md/CLAUDE.md at
// the project root on every run, which this repo never commits.
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
};

export default config;
