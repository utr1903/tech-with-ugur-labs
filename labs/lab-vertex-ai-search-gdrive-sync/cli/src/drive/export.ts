import type { drive_v3 } from "@googleapis/drive";

/**
 * `files.export` takes only `mimeType` — no `supportsAllDrives`. Passing one is
 * an error, which is easy to get wrong given every other call needs it.
 * Exported content is capped at 10 MB, far above anything here.
 */
export async function exportDocAsMarkdown(drive: drive_v3.Drive, fileId: string): Promise<string> {
  const { data } = await drive.files.export(
    { fileId, mimeType: "text/markdown" },
    { responseType: "text" },
  );
  return typeof data === "string" ? data : String(data);
}
