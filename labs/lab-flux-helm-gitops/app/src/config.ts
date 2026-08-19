export type AppConfig = {
  port: number;
  appVersion: number;
  apiToken: string;
  db: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function integer(name: string, raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error(
      `Environment variable ${name} must be a positive integer, got "${raw}".`,
    );
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  return {
    port: integer("PORT", env.PORT ?? "3000"),
    appVersion: integer("APP_VERSION", env.APP_VERSION ?? "1"),
    apiToken: required(env, "API_TOKEN"),
    db: {
      host: required(env, "PGHOST"),
      port: integer("PGPORT", env.PGPORT ?? "5432"),
      database: required(env, "PGDATABASE"),
      user: required(env, "PGUSER"),
      password: required(env, "PGPASSWORD"),
    },
  };
}
