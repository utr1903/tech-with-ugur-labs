import { Writable } from "node:stream";
import pino from "pino";
import { expect, it } from "vitest";
import { createRunner } from "./process.js";

it("passes arguments literally without shell evaluation", async () => {
  const runner = createRunner(pino({ level: "silent" }));
  expect(
    await runner(process.execPath, [
      "-e",
      "process.stdout.write(process.argv[1])",
      "literal;$(printf injected)",
    ]),
  ).toBe("literal;$(printf injected)");
});
it("rejects command failure with safe diagnostics and excludes stderr/body from JSON logs", async () => {
  let logs = "";
  const logger = pino(
    new Writable({
      write(chunk, _encoding, done) {
        logs += chunk;
        done();
      },
    }),
  );
  const runner = createRunner(logger);
  await expect(
    runner(process.execPath, ["-e", "process.exit(7)"]),
  ).rejects.toThrow("Execution failed.");
  expect(logs).not.toContain("process.exit");
  expect(logs).toContain('"category":"command"');
});
