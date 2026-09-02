import { attemptDirectByIp } from "../egress/bypass.js";
import type { Logger } from "../logger.js";

// Same claim as the run command's bypass attempt, one layer lower: given the
// destination's actual IP address - no name resolution involved at all - the
// workload still has no route to it.
export async function runBypassProbe(args: {
  ip: string;
  port: number;
  timeoutMs: number;
  logger: Logger;
}): Promise<number> {
  args.logger.info(
    { ip: args.ip, port: args.port },
    "Probing a destination by raw IP address...",
  );
  const outcome = await attemptDirectByIp({
    ip: args.ip,
    port: args.port,
    timeoutMs: args.timeoutMs,
  });
  args.logger.info(
    { ip: args.ip, port: args.port, ...outcome },
    "Bypass probe summary.",
  );
  return outcome.blocked ? 0 : 1;
}
