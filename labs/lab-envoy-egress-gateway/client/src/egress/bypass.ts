import { Resolver } from "node:dns/promises";
import net from "node:net";

export type BypassOutcome =
  | { blocked: true; stage: "dns" | "connect"; code: string }
  | { blocked: false; stage: "connect"; code: "CONNECTED" };

export type Resolve4 = (host: string) => Promise<string[]>;

function errorCode(err: unknown): string {
  return (err as NodeJS.ErrnoException).code ?? "EUNKNOWN";
}

// Try to open a TCP connection to a raw address, with no proxy in the path.
// On the workload network there is no route to the destination's network, so
// the kernel rejects this before a packet leaves the container.
export function attemptDirectByIp(args: {
  ip: string;
  port: number;
  timeoutMs: number;
}): Promise<BypassOutcome> {
  return new Promise((resolve) => {
    const socket = net.connect({
      host: args.ip,
      port: args.port,
      timeout: args.timeoutMs,
    });
    socket.on("connect", () => {
      socket.destroy();
      resolve({ blocked: false, stage: "connect", code: "CONNECTED" });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ blocked: true, stage: "connect", code: "ETIMEDOUT" });
    });
    socket.on("error", (err) =>
      resolve({ blocked: true, stage: "connect", code: errorCode(err) }),
    );
  });
}

// The same attempt, starting from a name. On the workload network the name of a
// destination that lives on the far side of the gateway does not resolve at all,
// so the bypass usually dies one step earlier than the connection attempt.
export async function attemptDirectByName(args: {
  host: string;
  port: number;
  timeoutMs: number;
  resolve4?: Resolve4;
}): Promise<BypassOutcome> {
  const resolve4 =
    args.resolve4 ??
    ((host: string) =>
      new Resolver({ timeout: args.timeoutMs, tries: 1 }).resolve4(host));
  let addresses: string[];
  try {
    addresses = await resolve4(args.host);
  } catch (err) {
    return { blocked: true, stage: "dns", code: errorCode(err) };
  }
  const ip = addresses[0];
  if (ip === undefined) {
    return { blocked: true, stage: "dns", code: "ENODATA" };
  }
  return attemptDirectByIp({ ip, port: args.port, timeoutMs: args.timeoutMs });
}
