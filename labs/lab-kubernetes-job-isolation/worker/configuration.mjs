import { join } from "node:path";

// Reject malformed execution inputs before creating files or starting the shell.
export function readConfiguration() {
  // Validate the server-owned UUID and byte budget before creating any files.
  const config = JSON.parse(process.env.EXECUTION_CONFIG);
  if (
    !config ||
    Array.isArray(config) ||
    Object.keys(config).length !== 2 ||
    typeof config.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      config.id,
    ) ||
    typeof config.message !== "string" ||
    config.message.length === 0 ||
    Buffer.byteLength(config.message) > 8192
  ) {
    throw new Error("Invalid execution configuration");
  }
  const outputPath = join(process.env.HOME, "data", `${config.id}.md`);
  const exitPath = join(process.env.HOME, "data", `${config.id}.exit`);
  const limit = Number(process.env.OUTPUT_LIMIT_BYTES);
  if (limit !== 65536) throw new Error("Invalid output limit");
  return {
    config,
    limit,
    outputPath,
    exitPath,
  };
}
