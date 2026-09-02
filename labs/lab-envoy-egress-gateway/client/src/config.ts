import { type PlanEntry, parsePlan } from "./egress/plan.js";

export type ClientConfig = {
  clientName: string;
  proxyHost: string;
  proxyPort: number;
  runSeconds: number;
  requestTimeoutMs: number;
  plan: PlanEntry[];
  deniedUrl: string;
  bypassHost: string;
  bypassPort: number;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} must be set.`);
  }
  return value;
}

function positiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got "${raw}").`);
  }
  return value;
}

function parseProxy(raw: string): { proxyHost: string; proxyPort: number } {
  const url = new URL(raw);
  if (!url.port) {
    throw new Error(
      `HTTP_PROXY must include the gateway's port (got "${raw}").`,
    );
  }
  return { proxyHost: url.hostname, proxyPort: Number(url.port) };
}

// The off-list destination is requested through the gateway exactly like a plan
// entry is, so it is held to the same standard as one - and, like the proxy url,
// it is parsed here at startup rather than five seconds into the run.
function parseDeniedUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`DENIED_URL must be a url (got "${raw}").`);
  }
  if (url.protocol !== "http:") {
    throw new Error(`DENIED_URL must use plain http (got "${raw}").`);
  }
  return raw;
}

export function loadConfig(env: NodeJS.ProcessEnv): ClientConfig {
  return {
    clientName: required(env, "CLIENT_NAME"),
    ...parseProxy(required(env, "HTTP_PROXY")),
    runSeconds: positiveInt(env, "RUN_SECONDS", 120),
    requestTimeoutMs: positiveInt(env, "REQUEST_TIMEOUT_MS", 10000),
    plan: parsePlan(required(env, "REQUEST_PLAN")),
    deniedUrl: parseDeniedUrl(required(env, "DENIED_URL")),
    bypassHost: required(env, "BYPASS_HOST"),
    bypassPort: positiveInt(env, "BYPASS_PORT", 8080),
  };
}
