import { describe, expect, it } from "vitest";
import { execInDeployment, mustKubectl } from "../support/cluster.js";
import { execute, expectHealthy } from "../support/sandbox-client.js";

describe("sandbox egress", () => {
  it("blocks connections from sandbox code while the server still reaches Postgres", async () => {
    const postgresIp = (
      await mustKubectl([
        "get",
        "svc",
        "postgres",
        "-o",
        "jsonpath={.spec.clusterIP}",
      ])
    ).trim();

    // Control: the same address and port are reachable from the server pod,
    // so a "blocked" below is the policy, not a missing Postgres.
    const control = await execInDeployment("server", [
      "node",
      "-e",
      `require('net').connect(5432, '${postgresIp}').on('connect', () => { process.stdout.write('connected\\n'); process.exit(0); }).on('error', (e) => { process.stdout.write('error ' + e.code + '\\n'); process.exit(1); })`,
    ]);
    expect(control.stdout.trim()).toBe("connected");

    const probe = await execute(
      [
        "import socket",
        "try:",
        `    socket.create_connection((${JSON.stringify(postgresIp)}, 5432), timeout=3)`,
        "    print('connected')",
        "except OSError:",
        "    print('blocked')",
        "try:",
        "    socket.getaddrinfo('postgres', 5432)",
        "    print('dns-ok')",
        "except OSError:",
        "    print('dns-blocked')",
      ].join("\n"),
    );
    expect(probe.stdout).toBe("blocked\ndns-blocked\n");
    await expectHealthy();
  });
});
