import { readFile } from "node:fs/promises";
import {
  type UrlRejection,
  type ValidUrl,
  validatePublicUrl,
} from "./scope.js";

type InputOrigin = { kind: "instruction" } | { kind: "file"; line: number };
interface RequestedUrl extends Pick<ValidUrl, "url" | "host"> {
  origins: InputOrigin[];
}
export interface ResearchRequest {
  instruction: string;
  requestedUrls: RequestedUrl[];
  invalidEntries: (UrlRejection & { origin: InputOrigin })[];
}

async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT")
      return "";
    throw err;
  }
}

function instructionUrls(instruction: string): string[] {
  const candidates =
    instruction.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"`]*/gi) ?? [];
  return candidates.map(trimUrlPunctuation);
}

function trimUrlPunctuation(candidate: string): string {
  let value = candidate.replace(/[.,;!?]+$/, "");
  let balance = [...value].reduce(
    (count, char) => count + (char === "(" ? 1 : 0) - (char === ")" ? 1 : 0),
    0,
  );
  while (balance < 0 && value.endsWith(")")) {
    value = value.slice(0, -1);
    balance += 1;
  }
  return value;
}

export async function readRequest(
  instruction: string,
  urlsFile: string,
): Promise<ResearchRequest> {
  const requested = new Map<string, RequestedUrl>();
  const invalidEntries: ResearchRequest["invalidEntries"] = [];
  const add = (raw: string, origin: InputOrigin): void => {
    const result = validatePublicUrl(raw);
    if (!result.valid) {
      invalidEntries.push({ ...result, origin });
      return;
    }
    const existing = requested.get(result.url);
    if (existing) existing.origins.push(origin);
    else
      requested.set(result.url, {
        url: result.url,
        host: result.host,
        origins: [origin],
      });
  };
  for (const raw of instructionUrls(instruction))
    add(raw, { kind: "instruction" });
  const content = await readOptionalFile(urlsFile);
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (line.trim()) add(line.trim(), { kind: "file", line: index + 1 });
  }
  return {
    instruction,
    requestedUrls: [...requested.values()],
    invalidEntries,
  };
}
