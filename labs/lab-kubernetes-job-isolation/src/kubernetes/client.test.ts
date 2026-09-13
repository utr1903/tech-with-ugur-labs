import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { BatchV1Api, KubeConfig, type V1Job } from "@kubernetes/client-node";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KubernetesJobClient } from "./client.js";

const id = "550e8400-e29b-41d4-a716-446655440000";
let server: Server;
let statuses: { code: number; body: unknown }[];
let requests: {
  method: string | undefined;
  url: string | undefined;
  body: unknown;
}[];
let hang: boolean;
let client: KubernetesJobClient;
beforeEach(async () => {
  statuses = [];
  requests = [];
  hang = false;
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      method: request.method,
      url: request.url,
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null,
    });
    if (hang) return;
    const status = statuses.shift() ?? {
      code: 200,
      body: {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: `execution-${id}` },
        status: { conditions: [{ type: "Complete", status: "True" }] },
      },
    };
    response.writeHead(status.code, { "Content-Type": "application/json" });
    response.end(JSON.stringify(status.body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const kube = new KubeConfig();
  kube.loadFromClusterAndUser(
    {
      name: "unit",
      skipTLSVerify: true,
      server: `http://127.0.0.1:${address.port}`,
    },
    { name: "unit" },
  );
  client = new KubernetesJobClient(
    kube.makeApiClient(BatchV1Api),
    { namespace: "unit", image: "worker:local", pvcName: "data", secure: true },
    pino({ level: "silent" }),
    5,
  );
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
describe("Kubernetes lifecycle through real generated client", () => {
  it("creates the namespaced fixed Job then polls until Complete", async () => {
    statuses = [
      {
        code: 201,
        body: {
          kind: "Job",
          apiVersion: "batch/v1",
          metadata: { name: `execution-${id}` },
        },
      },
      {
        code: 200,
        body: { kind: "Job", apiVersion: "batch/v1", status: { active: 1 } },
      },
    ];
    await client.create(id, "true");
    await client.wait(id, Date.now() + 500);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "/apis/batch/v1/namespaces/unit/jobs",
    });
    expect(
      (requests[0]?.body as V1Job | undefined)?.spec?.template.spec
        ?.containers[0]?.env?.[0]?.value,
    ).toBe(`{"id":"${id}","message":"true"}`);
    expect(requests.filter((request) => request.method === "GET")).toHaveLength(
      2,
    );
  });
  it.each([
    ["DeadlineExceeded", "timeout"],
    ["BackoffLimitExceeded", "infrastructure"],
  ] as const)("classifies failed %s", async (reason, kind) => {
    statuses = [
      {
        code: 200,
        body: {
          kind: "Job",
          apiVersion: "batch/v1",
          status: {
            failed: 1,
            conditions: [{ type: "Failed", status: "True", reason }],
          },
        },
      },
    ];
    await expect(client.wait(id, Date.now() + 500)).rejects.toMatchObject({
      kind,
    });
  });
  it("rejects a disappeared Job as infrastructure", async () => {
    statuses = [
      {
        code: 404,
        body: {
          kind: "Status",
          apiVersion: "v1",
          status: "Failure",
          code: 404,
          reason: "NotFound",
        },
      },
    ];
    await expect(client.wait(id, Date.now() + 500)).rejects.toMatchObject({
      kind: "infrastructure",
    });
  });
  it("times out a pending Job against the absolute deadline", async () => {
    statuses = Array.from({ length: 20 }, () => ({
      code: 200,
      body: { kind: "Job", apiVersion: "batch/v1", status: { active: 1 } },
    }));
    await expect(client.wait(id, Date.now() + 30)).rejects.toMatchObject({
      kind: "timeout",
    });
  });
  it("aborts a stalled API response at the absolute deadline", async () => {
    hang = true;
    await expect(client.wait(id, Date.now() + 30)).rejects.toMatchObject({
      kind: "timeout",
    });
  }, 1000);
  it("deletes foreground and waits for disappearance before releasing execution", async () => {
    statuses = [
      {
        code: 200,
        body: { kind: "Status", apiVersion: "v1", status: "Success" },
      },
      {
        code: 200,
        body: {
          kind: "Job",
          apiVersion: "batch/v1",
          metadata: { deletionTimestamp: new Date().toISOString() },
          status: { active: 1 },
        },
      },
      {
        code: 404,
        body: {
          kind: "Status",
          apiVersion: "v1",
          status: "Failure",
          code: 404,
        },
      },
    ];
    await client.remove(id, Date.now() + 500);
    expect(requests[0]?.method).toBe("DELETE");
    expect(requests[0]?.url).toContain("propagationPolicy=Foreground");
    expect(requests[0]?.url).toContain("gracePeriodSeconds=0");
    expect(requests).toHaveLength(3);
  });
  it("treats an already deleted Job as successful removal", async () => {
    statuses = [
      { code: 404, body: { kind: "Status", apiVersion: "v1", code: 404 } },
    ];
    await client.remove(id);
    expect(requests).toHaveLength(1);
  });
  it("propagates deletion infrastructure errors", async () => {
    statuses = [
      {
        code: 503,
        body: {
          kind: "Status",
          apiVersion: "v1",
          code: 503,
          message: "backend-sensitive-payload",
        },
      },
    ];
    await expect(client.remove(id)).rejects.toMatchObject({
      kind: "infrastructure",
    });
  });
});
it("bounds scheduling when the create API stalls", async () => {
  hang = true;
  await expect(
    client.create(id, "true", Date.now() + 30),
  ).rejects.toMatchObject({ kind: "timeout" });
}, 1000);
