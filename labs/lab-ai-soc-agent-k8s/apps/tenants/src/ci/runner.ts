import type { Queryable } from "../db/pool.js";
import type { Logger } from "../logger.js";

const HEARTBEAT_MS = 60_000;

// Stand-in for a CI agent: it idles and reports that it is alive. Its pod
// carries a service account token and database credentials, which is what
// the attack scenarios go after.
export function runCiRunner(logger: Logger, pool: Queryable): void {
  const beat = async () => {
    try {
      logger.info({}, "Sending heartbeat...");
      await pool.query<{ ok: number }>("SELECT 1 AS ok");
      logger.info({}, "Sending heartbeat succeeded.");
    } catch (err) {
      logger.error({ err }, "Sending heartbeat failed.");
    }
  };
  void beat();
  setInterval(beat, HEARTBEAT_MS);
}
