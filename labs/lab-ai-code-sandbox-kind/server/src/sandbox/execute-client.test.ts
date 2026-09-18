import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import {
  assertClientTimeoutExceedsExecution,
  createExecuteClient,
} from "./execute-client.js";

const logger = pino({ level: "silent" });
const execution = {
  status: "succeeded",
  exitCode: 0,
  stdout: "4\n",
  stderr: "",
  result: null,
  resultError: null,
  durationMs: 12,
  truncated: false,
};

function client(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
) {
  return createExecuteClient({
    sandboxUrl: "http://sandbox:8000",
    timeoutMs: 1_000,
    logger,
    fetchImpl,
  });
}

describe("execute client", () => {
  it("posts the code once and returns the execution", async () => {
    const fetchImpl = vi.fn(async () => Response.json(execution));
    expect(await client(fetchImpl).execute("print(2+2)")).toEqual({
      kind: "executed",
      execution,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://sandbox:8000/execute");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ code: "print(2+2)" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps 429 to busy, 400 to rejected and network errors to unreachable", async () => {
    expect(
      await client(async () => new Response("{}", { status: 429 })).execute(
        "x",
      ),
    ).toEqual({
      kind: "busy",
    });
    const rejected = await client(async () =>
      Response.json(
        { error: "invalid_request", message: "too big" },
        { status: 400 },
      ),
    ).execute("x");
    expect(rejected).toEqual({ kind: "rejected", message: "too big" });
    const down = await client(async () => {
      throw new TypeError("fetch failed");
    }).execute("x");
    expect(down.kind).toBe("unreachable");
  });

  it("treats an unexpected status or body as unreachable", async () => {
    expect(
      (
        await client(async () => new Response("oops", { status: 500 })).execute(
          "x",
        )
      ).kind,
    ).toBe("unreachable");
    expect(
      (await client(async () => Response.json({ nope: 1 })).execute("x")).kind,
    ).toBe("unreachable");
  });

  it("logs success only for an execution and a warning for any other outcome", async () => {
    const lines: Record<string, unknown>[] = [];
    const capturing = pino(
      { level: "info" },
      { write: (line: string) => lines.push(JSON.parse(line)) },
    );
    const logged = async (respond: () => Promise<Response>) => {
      lines.length = 0;
      await createExecuteClient({
        sandboxUrl: "http://sandbox:8000",
        timeoutMs: 1_000,
        logger: capturing,
        fetchImpl: respond,
      }).execute("x");
      return lines.at(-1) ?? {};
    };

    expect(await logged(async () => Response.json(execution))).toMatchObject({
      level: 30,
      msg: "Executing code in sandbox succeeded.",
      kind: "executed",
      status: "succeeded",
    });
    for (const [respond, kind] of [
      [async () => new Response("oops", { status: 500 }), "unreachable"],
      [async () => Response.json({ nope: 1 }), "unreachable"],
      [async () => new Response("{}", { status: 429 }), "busy"],
      [
        async () => Response.json({ message: "too big" }, { status: 400 }),
        "rejected",
      ],
    ] as const) {
      const line = await logged(respond);
      expect(line).toMatchObject({
        level: 40,
        msg: "Executing code in sandbox failed.",
        kind,
      });
      expect(line.durationMs).toEqual(expect.any(Number));
    }
    expect(
      await logged(async () => {
        throw new TypeError("fetch failed");
      }),
    ).toMatchObject({ level: 50, msg: "Executing code in sandbox failed." });
  });

  it("requires the client timeout to be longer than the execution timeout", () => {
    expect(() => assertClientTimeoutExceedsExecution(30_000, 30)).toThrow(
      /longer/,
    );
    expect(() => assertClientTimeoutExceedsExecution(45_000, 30)).not.toThrow();
  });
});
