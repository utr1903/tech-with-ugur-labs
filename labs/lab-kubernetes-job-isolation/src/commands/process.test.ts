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
it("logs the exact executable and arguments on failure without backend stderr/body", async () => {
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
  const records = logs
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records).toHaveLength(2);
  expect(records.map((record) => record.level)).toEqual([30, 50]);
  for (const record of records) {
    expect(record.command).toBe(process.execPath);
    expect(record.args).toEqual(["-e", "process.exit(7)"]);
    expect(record.cwd).toEqual(expect.any(String));
  }
  expect(records[1].exitCode).toBe(7);
  expect(logs).toContain('"category":"command"');
});

it("logs command context and an output size summary on successful execution", async () => {
  let logs = "";
  const runner = createRunner(
    pino(
      new Writable({
        write(chunk, _encoding, done) {
          logs += chunk;
          done();
        },
      }),
    ),
  );
  expect(
    await runner(process.execPath, ["-e", "process.stdout.write('done')"]),
  ).toBe("done");
  const records = logs
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records.map((record) => record.level)).toEqual([30, 30]);
  expect(records[0].args).toEqual(["-e", "process.stdout.write('done')"]);
  expect(records[1].outputBytes).toBe(4);
  expect(records[1].output).toBeUndefined();
});
