import type { Logger } from "../logger.js";

export type Exec = (command: string) => Promise<{ stdout: string }>;

// INTENDED VULNERABILITY: this lab's storefront has a command injection
// on purpose. The URL is pasted into a shell command without any escaping,
// so `http://x;id` runs `id`. The attack scenarios rely on it. Never copy
// this pattern into real code.
export function buildPreviewCommand(url: string): string {
  return `curl -sI --max-time 5 ${url}`;
}

export async function runPreview(
  logger: Logger,
  url: string,
  exec: Exec,
): Promise<{ status: number; firstLine: string }> {
  try {
    logger.info({ url }, "Previewing link...");
    const { stdout } = await exec(buildPreviewCommand(url));
    const firstLine = stdout.split("\n")[0]?.trim() ?? "";
    const status = Number(firstLine.split(" ")[1] ?? 0) || 0;
    logger.info({ status }, "Previewing link succeeded.");
    return { status, firstLine };
  } catch (err) {
    logger.error({ err, url }, "Previewing link failed.");
    throw err;
  }
}
