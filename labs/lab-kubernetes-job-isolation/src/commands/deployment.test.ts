import { expect, it } from "vitest";
import { deploy } from "./deployment.js";

it("loads all named images before deployment and waits CNI and seeded servers", async () => {
  const calls: { command: string; args: string[] }[] = [];
  await deploy(async (command, args) => {
    calls.push({ command, args });
    if (command === "kind" && args[0] === "get") return "";
    if (
      command === "kubectl" &&
      args.includes("get") &&
      args.includes("namespace")
    )
      return "";
    return "";
  });
  for (const call of calls.filter((call) => call.command === "kubectl"))
    expect(call.args.slice(0, 2)).toEqual(["--context", "kind-job-isolation"]);
  for (const call of calls.filter(
    (call) => call.command === "helm" && call.args.includes("upgrade"),
  ))
    expect(call.args).toContain("kind-job-isolation");
  expect(
    calls.find((call) => call.command === "kind" && call.args[0] === "create")
      ?.args,
  ).toContain("deploy/kind.yaml");
  const load = calls.findIndex(
    (call) => call.command === "kind" && call.args[0] === "load",
  );
  const releases = calls
    .map((call, index) => ({ call, index }))
    .filter(
      ({ call }) =>
        call.command === "helm" && call.args.includes("deploy/chart"),
    );
  expect(releases).toHaveLength(2);
  expect(releases.every(({ index }) => index > load)).toBe(true);
  expect(calls[load]?.args).toEqual([
    "load",
    "docker-image",
    "lab-kubernetes-job-isolation-server:local-v1",
    "lab-kubernetes-job-isolation-worker:local-v1",
    "lab-kubernetes-job-isolation-fixture:local-v1",
    "--name",
    "job-isolation",
  ]);
  expect(
    calls.some(
      (call) =>
        call.args.includes("daemonset/cilium-envoy") &&
        call.args.includes("status"),
    ),
  ).toBe(true);
  expect(
    calls.some(
      (call) =>
        call.args.includes("deployment/cilium-operator") &&
        call.args.includes("status"),
    ),
  ).toBe(true);
  expect(
    calls.some(
      (call) =>
        call.args.includes("deployment/server") && call.args.includes("secure"),
    ),
  ).toBe(true);
});
it("refuses an existing cluster whose kind identity or pinned node image differs", async () => {
  const calls: string[] = [];
  await expect(
    deploy(async (command, args) => {
      calls.push(`${command}:${args[0]}`);
      if (command === "kind" && args.includes("clusters"))
        return "job-isolation\n";
      if (command === "kind" && args.includes("nodes"))
        return "job-isolation-control-plane\n";
      if (command === "docker")
        return JSON.stringify([
          {
            Config: {
              Image: "unrelated",
              Labels: { "io.x-k8s.kind.cluster": "other" },
            },
          },
        ]);
      return "";
    }),
  ).rejects.toThrow(
    "Existing cluster is not the pinned lab cluster. Run teardown only after checking ownership.",
  );
  expect(calls).not.toContain("kind:delete");
  expect(calls).not.toContain("helm:upgrade");
});

it("refuses to overwrite a fixture namespace belonging to another application", async () => {
  const applied: string[][] = [];
  await expect(
    deploy(async (command, args) => {
      if (
        command === "kubectl" &&
        args.includes("get") &&
        args.includes("namespace")
      ) {
        if (args.includes("download-fixture"))
          return JSON.stringify({
            metadata: { labels: { "app.kubernetes.io/part-of": "unrelated" } },
          });
        return "";
      }
      if (command === "kubectl" && args.includes("apply")) applied.push(args);
      return "";
    }),
  ).rejects.toThrow("Namespace already exists outside this lab.");
  expect(applied).toEqual([]);
});
