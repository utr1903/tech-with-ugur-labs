export type DrillConfig = {
  projectId: string;
  instanceName: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): DrillConfig {
  const rawPort = env.DB_PORT ?? "5432";
  const dbPort = Number(rawPort);
  if (!Number.isInteger(dbPort) || dbPort <= 0) {
    throw new Error(`DB_PORT must be a positive integer, got: ${rawPort}`);
  }
  return {
    projectId: required(env, "GCP_PROJECT_ID"),
    instanceName: required(env, "CLOUDSQL_INSTANCE"),
    dbHost: required(env, "DB_HOST"),
    dbPort,
    dbName: required(env, "DB_NAME"),
    dbUser: required(env, "DB_USER"),
    dbPassword: required(env, "DB_PASSWORD"),
  };
}
