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

export function loadConfig(env: NodeJS.ProcessEnv): ClientConfig {
  return {
    clientName: required(env, "CLIENT_NAME"),
    ...parseProxy(required(env, "HTTP_PROXY")),
    runSeconds: positiveInt(env, "RUN_SECONDS", 120),
    requestTimeoutMs: positiveInt(env, "REQUEST_TIMEOUT_MS", 10000),
    plan: parsePlan(required(env, "REQUEST_PLAN")),
    deniedUrl: required(env, "DENIED_URL"),
    bypassHost: required(env, "BYPASS_HOST"),
    bypassPort: positiveInt(env, "BYPASS_PORT", 8080),
  };
}
