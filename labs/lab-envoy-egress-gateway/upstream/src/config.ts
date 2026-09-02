export type UpstreamConfig = {
  port: number;
  payloadBytes: number;
  destinationName: string;
};

function requirePositiveInt(env: NodeJS.ProcessEnv, name: string): number {
  const raw = env[name];
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got ${String(raw)}).`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): UpstreamConfig {
  const destinationName = env.DESTINATION_NAME;
  if (!destinationName) {
    throw new Error(
      "DESTINATION_NAME must be set to the FQDN this destination answers as.",
    );
  }
  return {
    port: env.PORT === undefined ? 8080 : requirePositiveInt(env, "PORT"),
    payloadBytes: requirePositiveInt(env, "PAYLOAD_BYTES"),
    destinationName,
  };
}
