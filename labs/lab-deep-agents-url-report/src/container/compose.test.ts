import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const labDirectory = fileURLToPath(new URL("../../", import.meta.url));

// Catches accidental secret forwarding, host mounts, or container privilege expansion.
it("renders only the intended credentials and isolated input/output workspace", () => {
  expect(existsSync(join(labDirectory, "compose.yaml"))).toBe(true);
  const rendered = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      "/dev/null",
      "--file",
      join(labDirectory, "compose.yaml"),
      "config",
      "--format",
      "json",
    ],
    {
      cwd: labDirectory,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        OPENAI_API_KEY: "",
        FIRECRAWL_API_KEY: "",
        COMPOSE_DISABLE_ENV_FILE: "1",
      },
    },
  );
  // Do not include rendered stdout/stderr in assertions: they can contain secrets.
  expect(rendered.status).toBe(0);
  const config = JSON.parse(rendered.stdout);
  expect(Object.keys(config.services)).toEqual(["researcher"]);
  const service = config.services.researcher;
  expect(Object.keys(service.environment).sort()).toEqual([
    "FIRECRAWL_API_KEY",
    "OPENAI_API_KEY",
  ]);
  expect(service.volumes).toEqual([
    {
      type: "bind",
      source: join(labDirectory, "workspace/input"),
      target: "/app/workspace/input",
      read_only: true,
      bind: {},
    },
    {
      type: "bind",
      source: join(labDirectory, "workspace/output"),
      target: "/app/workspace/output",
      bind: {},
    },
  ]);
  expect(service.user).toBe("1000:1000");
  expect(service.read_only).toBe(true);
  expect(service.tmpfs).toEqual(["/tmp:rw,noexec,nosuid,size=16777216"]);
  expect(service.cap_drop).toEqual(["ALL"]);
  expect(service.cap_add ?? []).toEqual([]);
  expect(service.security_opt).toEqual(["no-new-privileges:true"]);
  expect(service.ports ?? []).toEqual([]);
  expect(service.devices ?? []).toEqual([]);
  expect(service.privileged ?? false).toBe(false);
  expect(service.network_mode).not.toBe("host");
  expect(service.pid).not.toBe("host");
  expect(service.ipc).not.toBe("host");
  expect(service.env_file ?? []).toEqual([]);
});
