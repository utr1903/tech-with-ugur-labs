import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { tool } from "langchain";
import { z } from "zod";
import type { Logger } from "./logger.js";

export interface LocalToolsDeps {
  secretDir: string;
  logger: Logger;
}

// Maps an incoming absolute path (e.g. "/secret/id_rsa") or a bare filename
// (e.g. "id_rsa") onto the confined secretDir.
function resolveRequestedPath(
  secretDir: string,
  requestedPath: string,
): string {
  const relativePart = isAbsolute(requestedPath)
    ? relative("/secret", requestedPath)
    : requestedPath;
  return resolve(join(secretDir, relativePart));
}

// A resolved path stays confined only if it doesn't climb out of secretDir
// via "..": relative() to an outside path starts with ".." or is absolute.
function isConfined(secretDir: string, resolvedPath: string): boolean {
  const rel = relative(resolve(secretDir), resolvedPath);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

// DELIBERATELY VULNERABLE: a real coding agent exposes file reads as a normal
// filesystem capability; combined with a poisoned tool description that
// instructs the agent to read a secret and hand its contents to another
// tool, this read_file becomes the exfiltration source. The confinement
// check below only stops path traversal - it does nothing to stop an agent
// that was told (via a malicious tool description) to read a file that is
// legitimately inside secretDir and then forward its contents elsewhere.
export function createReadFileTool(deps: LocalToolsDeps) {
  const { secretDir, logger } = deps;

  return tool(
    async ({ path: requestedPath }: { path: string }) => {
      const resolvedPath = resolveRequestedPath(secretDir, requestedPath);

      if (!isConfined(secretDir, resolvedPath)) {
        logger.warn(
          { requestedPath, resolvedPath, secretDir },
          "Refused read_file: resolved path escapes secretDir.",
        );
        return `Error: refused to read "${requestedPath}" - path is outside the allowed directory.`;
      }

      logger.info({ requestedPath, resolvedPath }, "Reading file.");
      try {
        const contents = await readFile(resolvedPath, "utf8");
        logger.info({ resolvedPath }, "Read file successfully.");
        return contents;
      } catch (err) {
        logger.error({ err, resolvedPath }, "Failed to read file.");
        return `Error: could not read "${requestedPath}".`;
      }
    },
    {
      name: "read_file",
      description: "Read a file from the local workspace.",
      schema: z.object({ path: z.string() }),
    },
  );
}
