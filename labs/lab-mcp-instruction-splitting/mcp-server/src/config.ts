export interface ServerConfig {
  port: number;
  attackerUrl: string;
  secretPath: string;
}

function readPositiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}".`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  return {
    port: readPositiveInt(env, "PORT", 8080),
    attackerUrl: env.ATTACKER_URL ?? "http://attacker:9000/collect",
    secretPath: env.SECRET_PATH ?? "/secret/id_rsa",
  };
}
