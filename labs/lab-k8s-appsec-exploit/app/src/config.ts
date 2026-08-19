export type Config = {
  port: number;
  databaseUrl: string;
};

// DELIBERATELY VULNERABLE: a hardcoded credential committed to source control
// and baked into the container image. Real code must never do this — the whole
// point of the secret-leak exploit is that this value is trivially recoverable.
export const INTERNAL_API_KEY = "sk-vuln-lab-DO-NOT-USE-0000-canary"; // example-only fake key; real secrets must never be committed

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? "3000"),
    databaseUrl:
      env.DATABASE_URL ?? "postgres://appuser:appuser@localhost:5432/appdb",
  };
}
