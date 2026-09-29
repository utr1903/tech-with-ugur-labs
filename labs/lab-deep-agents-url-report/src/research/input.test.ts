import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRequest } from "./input.js";

let directory: string;
let file: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "url-report-"));
  file = join(directory, "urls.txt");
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("readRequest", () => {
  it("reads prompt URLs when the optional file is absent", async () => {
    expect(await readRequest("Explain https://example.com/a", file)).toEqual({
      instruction: "Explain https://example.com/a",
      requestedUrls: [
        {
          url: "https://example.com/a",
          host: "example.com",
          origins: [{ kind: "instruction" }],
        },
      ],
      invalidEntries: [],
    });
  });
  it("keeps an instruction without URLs as a valid parsed request", async () => {
    expect(await readRequest("Explain the topic", file)).toEqual({
      instruction: "Explain the topic",
      requestedUrls: [],
      invalidEntries: [],
    });
  });
  it("retains multiple file URLs and their line origins", async () => {
    await writeFile(file, "https://example.com/a\n\nhttps://other.example/b\n");
    expect(await readRequest("Compare", file)).toMatchObject({
      requestedUrls: [
        { url: "https://example.com/a", origins: [{ kind: "file", line: 1 }] },
        {
          url: "https://other.example/b",
          origins: [{ kind: "file", line: 3 }],
        },
      ],
    });
  });
  it("deduplicates normalized URLs while retaining all origins", async () => {
    await writeFile(
      file,
      "https://EXAMPLE.com:443/a#two\nhttps://example.com/a\n",
    );
    expect(
      await readRequest("Read https://example.com/a#one", file),
    ).toMatchObject({
      requestedUrls: [
        {
          url: "https://example.com/a",
          origins: [
            { kind: "instruction" },
            { kind: "file", line: 1 },
            { kind: "file", line: 2 },
          ],
        },
      ],
    });
  });
  it("records invalid entries rather than dropping them", async () => {
    await writeFile(
      file,
      "bad URL\nhttp://10.0.0.1\nhttps://u:p@example.com\n",
    );
    expect(await readRequest("Read http://localhost", file)).toMatchObject({
      requestedUrls: [],
      invalidEntries: [
        {
          raw: "http://localhost",
          reason: "private-host",
          origin: { kind: "instruction" },
        },
        {
          raw: "bad URL",
          reason: "malformed",
          origin: { kind: "file", line: 1 },
        },
        {
          raw: "http://10.0.0.1",
          reason: "private-host",
          origin: { kind: "file", line: 2 },
        },
        {
          raw: "https://u:p@example.com",
          reason: "credentials",
          origin: { kind: "file", line: 3 },
        },
      ],
    });
  });
  it("extracts URLs from Markdown and sentence punctuation", async () => {
    expect(
      await readRequest(
        "Read [A](https://example.com/a), then https://other.example/b.",
        file,
      ),
    ).toMatchObject({
      requestedUrls: [
        { url: "https://example.com/a" },
        { url: "https://other.example/b" },
      ],
    });
  });
  it("preserves balanced parentheses within URL paths", async () => {
    expect(
      await readRequest("Read [A](https://example.com/topic_(detail)).", file),
    ).toMatchObject({
      requestedUrls: [{ url: "https://example.com/topic_(detail)" }],
    });
  });
  it("retains requests beyond the later sixteen-page budget", async () => {
    await writeFile(
      file,
      Array.from({ length: 20 }, (_, i) => `https://example.com/${i}`).join(
        "\n",
      ),
    );
    const request = await readRequest("Read every page", file);
    expect(request.requestedUrls).toHaveLength(20);
  });
  it("propagates file errors other than absence", async () => {
    await expect(readRequest("Read", directory)).rejects.toThrow();
  });
});
