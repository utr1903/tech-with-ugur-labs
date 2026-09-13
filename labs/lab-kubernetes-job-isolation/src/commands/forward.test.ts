import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";
import { identity, stopOwned } from "./forward.js";

it("never kills a reused or unrelated PID, even with a matching identity in local state", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  await once(child, "spawn");
  const pid = child.pid ?? 0;
  try {
    await stopOwned({
      pid,
      identity: "previous process",
      namespace: "secure",
      port: 3001,
      log: "ignored",
    });
    expect(child.exitCode).toBeNull();
    await stopOwned({
      pid,
      identity: identity(pid) ?? "",
      namespace: "secure",
      port: 3001,
      log: "ignored",
    });
    process.kill(pid, 0);
    expect(child.exitCode).toBeNull();
  } finally {
    child.kill();
    await once(child, "exit");
  }
});
