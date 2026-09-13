import { expect, it } from "vitest";
import { Cluster, summarize } from "./cluster.js";

it("keeps kubectl arguments literal and pins every operation to the named context", async () => {
  const calls: { command: string; args: string[] }[] = [];
  const cluster = new Cluster(async (command, args) => {
    calls.push({ command, args });
    return '{"items":[]}';
  });
  await cluster.get("secure", "pods");
  await cluster.exec("insecure", "server-abc", [
    "node",
    "-e",
    "$(unsafe); literal",
  ]);
  await cluster.runningWorkers();
  expect(calls).toEqual([
    {
      command: "kubectl",
      args: [
        "--context",
        "kind-job-isolation",
        "-n",
        "secure",
        "get",
        "pods",
        "-o",
        "json",
      ],
    },
    {
      command: "kubectl",
      args: [
        "--context",
        "kind-job-isolation",
        "-n",
        "insecure",
        "exec",
        "server-abc",
        "--",
        "node",
        "-e",
        "$(unsafe); literal",
      ],
    },
    {
      command: "docker",
      args: [
        "exec",
        "job-isolation-control-plane",
        "crictl",
        "ps",
        "--state",
        "Running",
        "--name",
        "worker",
        "-o",
        "json",
      ],
    },
  ]);
});
it("retains real Job/pod identity and policy evidence without submitted command data", () => {
  const evidence = summarize(
    {
      metadata: {
        uid: "job-uid",
        name: "execution-id",
        labels: { "execution-id": "id" },
      },
      spec: { backoffLimit: 0, template: { spec: { containers: [] } } },
    },
    [
      {
        metadata: { uid: "pod-uid", labels: { "execution-id": "id" } },
        spec: {
          containers: [
            {
              name: "worker",
              image: "image",
              env: [{ name: "EXECUTION_CONFIG", value: "PRIVATE_COMMAND" }],
            },
          ],
        },
        status: {
          containerStatuses: [
            {
              name: "worker",
              image: "image",
              imageID: "digest",
              ready: false,
              restartCount: 0,
            },
          ],
        },
      },
    ],
  );
  expect(evidence.uid).toBe("job-uid");
  expect(evidence.pods[0]?.uid).toBe("pod-uid");
  expect(JSON.stringify(evidence)).not.toContain("PRIVATE_COMMAND");
  expect(evidence.pods[0]?.statuses?.[0]?.restartCount).toBe(0);
});
