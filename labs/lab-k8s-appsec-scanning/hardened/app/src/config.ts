export type Config = {
  port: number;
  databaseUrl: string;
};

export function loadInternalApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.INTERNAL_API_KEY ?? "";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? "3000"),
    databaseUrl:
      env.DATABASE_URL ?? "postgres://appuser:appuser@localhost:5432/appdb",
  };
}
