import { createServer } from "node:http";
import { type AddressInfo, connect } from "node:net";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandler } from "./handler.js";

type LogLine = { msg: string; alertname?: string; status?: string };

function makeTestLogger(): { logger: pino.Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger = pino(
    {},
    {
      write(chunk: string) {
        lines.push(JSON.parse(chunk) as LogLine);
      },
    },
  );
  return { logger, lines };
}

describe("createHandler", () => {
  let baseUrl: string;
  let lines: LogLine[];
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    const test = makeTestLogger();
    lines = test.lines;
    server = createServer(createHandler({ logger: test.logger }));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("responds 200 to /healthz", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
  });

  it("accepts a Grafana payload on POST /alerts and logs one line per alert", async () => {
    const payload = {
      alerts: [
        { status: "firing", labels: { alertname: "LabNodeCpuHigh" } },
        { status: "firing", labels: { alertname: "LabPodCpuHigh" } },
      ],
    };
    const res = await fetch(`${baseUrl}/alerts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const received = lines.filter(
      (l) => l.msg === "Receiving alert succeeded.",
    );
    expect(received.map((l) => l.alertname)).toEqual([
      "LabNodeCpuHigh",
      "LabPodCpuHigh",
    ]);
  });

  it("responds 400 to malformed JSON and stays alive", async () => {
    const res = await fetch(`${baseUrl}/alerts`, {
      method: "POST",
      body: "{nope",
    });
    expect(res.status).toBe(400);
    const health = await fetch(`${baseUrl}/healthz`);
    expect(health.status).toBe(200);
  });

  it("responds 404 elsewhere", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });

  it("survives a client aborting mid-body and keeps serving", async () => {
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((resolve) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write(
          "POST /alerts HTTP/1.1\r\n" +
            "Host: 127.0.0.1\r\n" +
            "Content-Type: application/json\r\n" +
            "Content-Length: 1000\r\n" +
            "\r\n" +
            '{"alerts":[',
        );
        // Let the server start reading the body, then abort the connection
        // mid-stream instead of sending the promised 1000 bytes.
        setTimeout(() => {
          socket.destroy();
          resolve();
        }, 50);
      });
      socket.on("error", () => resolve());
    });

    // Give the aborted request's rejection a moment to propagate before
    // proving the process (and this server) is still alive.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const health = await fetch(`${baseUrl}/healthz`);
    expect(health.status).toBe(200);
  });
});
