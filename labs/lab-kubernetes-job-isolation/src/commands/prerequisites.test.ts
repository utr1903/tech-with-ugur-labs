import { expect, it } from "vitest";
import { prerequisites } from "./prerequisites.js";

it("accepts pinned tools and a running Linux Docker daemon", async () => {
  await expect(
    prerequisites(async (command) => {
      if (command === "kind") return "kind v0.32.0 go1.26.3 darwin/arm64\n";
      if (command === "helm") return "v4.2.4+g3900f43\n";
      if (command === "kubectl")
        return JSON.stringify({ clientVersion: { gitVersion: "v1.36.3" } });
      return "linux/aarch64\n";
    }),
  ).resolves.toBeUndefined();
});
it("rejects an unpinned kubectl before any cluster operation", async () => {
  const commands: string[] = [];
  await expect(
    prerequisites(async (command) => {
      commands.push(command);
      if (command === "kind") return "kind v0.32.0 go1.26.3 darwin/arm64\n";
      if (command === "helm") return "v4.2.4+g3900f43\n";
      return JSON.stringify({ clientVersion: { gitVersion: "v1.35.0" } });
    }),
  ).rejects.toThrow("Install the pinned kubectl version.");
  expect(commands).not.toContain("docker");
});
