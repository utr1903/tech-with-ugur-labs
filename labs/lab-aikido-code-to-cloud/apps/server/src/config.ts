export interface Config {
  port: number;
  awsRegion: string;
  dataBucket: string;
  bedrockModelId: string;
  aikidoToken?: string;
  aikidoBlock: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (!env.DATA_BUCKET) throw new Error("DATA_BUCKET is required");
  return {
    port: env.PORT ? Number(env.PORT) : 8080,
    awsRegion: env.AWS_REGION || "eu-central-1",
    dataBucket: env.DATA_BUCKET,
    bedrockModelId: env.BEDROCK_MODEL_ID || "eu.amazon.nova-2-lite-v1:0",
    aikidoToken: env.AIKIDO_TOKEN || undefined,
    aikidoBlock: env.AIKIDO_BLOCK !== "false",
  };
}
