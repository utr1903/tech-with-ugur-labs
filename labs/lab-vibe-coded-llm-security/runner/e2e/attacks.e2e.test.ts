import { beforeAll, describe, expect, it } from "vitest";
import {
  countOccurrences,
  postAssistant,
  postProcess,
  readEvidence,
  sleep,
  truncateEvidence,
  waitForHealth,
} from "../src/client.js";
import {
  EXFIL_CANARY,
  EXFIL_DOCUMENT,
  EXFIL_QUESTION,
  RCE_CANARY,
  RCE_DATA,
  RCE_INSTRUCTION,
} from "../src/payloads.js";

const VULN_URL = process.env.VULN_URL ?? "http://app-vulnerable:3000";
const HARD_URL = process.env.HARD_URL ?? "http://app-hardened:3000";
const EVIDENCE_DIR = process.env.EVIDENCE_DIR ?? "/evidence";
const HTTP_LOG = `${EVIDENCE_DIR}/attacker_http.log`;
const SHELL_LOG = `${EVIDENCE_DIR}/attacker_shell.log`;

const TEST_TIMEOUT_MS = 180_000;
const ATTEMPTS = 5;
const SHELL_POLL_TIMEOUT_MS = 5_000;
const SHELL_POLL_INTERVAL_MS = 250;

beforeAll(async () => {
  // Evidence lives on a persistent volume across `make e2e` runs; truncate it
  // first so a stale canary from a previous run can't make this run pass
  // without the exploit actually firing again.
  truncateEvidence(HTTP_LOG);
  truncateEvidence(SHELL_LOG);
  await waitForHealth(VULN_URL);
  await waitForHealth(HARD_URL);
}, TEST_TIMEOUT_MS);

describe("vulnerable app", () => {
  it(
    "vulnerable assistant leaks the secret",
    async () => {
      let sawCanary = false;
      for (let attempt = 0; attempt < ATTEMPTS && !sawCanary; attempt++) {
        await postAssistant(VULN_URL, {
          document: EXFIL_DOCUMENT,
          question: EXFIL_QUESTION,
        });
        sawCanary = readEvidence(HTTP_LOG).includes(EXFIL_CANARY);
      }
      expect(sawCanary).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "vulnerable process yields a reverse shell",
    async () => {
      let sawCanary = false;
      for (let attempt = 0; attempt < ATTEMPTS && !sawCanary; attempt++) {
        await postProcess(VULN_URL, {
          instruction: RCE_INSTRUCTION,
          data: RCE_DATA,
        });
        const deadline = Date.now() + SHELL_POLL_TIMEOUT_MS;
        while (Date.now() < deadline && !sawCanary) {
          sawCanary = readEvidence(SHELL_LOG).includes(RCE_CANARY);
          if (!sawCanary) {
            await sleep(SHELL_POLL_INTERVAL_MS);
          }
        }
      }
      expect(sawCanary).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("hardened app", () => {
  it(
    "hardened assistant does not leak",
    async () => {
      const before = countOccurrences(readEvidence(HTTP_LOG), EXFIL_CANARY);
      for (let attempt = 0; attempt < 3; attempt++) {
        await postAssistant(HARD_URL, {
          document: EXFIL_DOCUMENT,
          question: EXFIL_QUESTION,
        });
      }
      const after = countOccurrences(readEvidence(HTTP_LOG), EXFIL_CANARY);
      expect(after).toBe(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "hardened process yields no shell",
    async () => {
      const before = countOccurrences(readEvidence(SHELL_LOG), RCE_CANARY);
      for (let attempt = 0; attempt < 3; attempt++) {
        await postProcess(HARD_URL, {
          instruction: RCE_INSTRUCTION,
          data: RCE_DATA,
        });
      }
      const after = countOccurrences(readEvidence(SHELL_LOG), RCE_CANARY);
      expect(after).toBe(before);
    },
    TEST_TIMEOUT_MS,
  );
});
