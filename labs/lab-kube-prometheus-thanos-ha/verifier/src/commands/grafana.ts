import type { Ctx } from "../context.js";
import { pollUntil } from "../lib/poll.js";

type FetchJson = (path: string) => Promise<unknown>;

function grafanaFetcher(ctx: Ctx): FetchJson {
  const auth = Buffer.from(
    `${ctx.cfg.grafanaUser}:${ctx.cfg.grafanaPassword}`,
  ).toString("base64");
  return async (path: string) => {
    const res = await fetch(`${ctx.cfg.grafanaUrl}${path}`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Grafana ${path} returned HTTP ${res.status}`);
    return res.json();
  };
}

// The dashboard and both datasources arrive asynchronously (sidecar +
// provisioning), so everything here polls.
export async function runGrafana(ctx: Ctx): Promise<void> {
  const logger = ctx.logger.child({ command: "grafana" });
  const get = grafanaFetcher(ctx);
  try {
    logger.info("Checking Grafana provisioning...");
    await pollUntil({
      logger,
      description: "Grafana is healthy",
      timeoutSeconds: 120,
      intervalSeconds: 5,
      attempt: () => get("/api/health"),
    });
    await pollUntil({
      logger,
      description: "both comparison datasources exist",
      timeoutSeconds: 120,
      intervalSeconds: 5,
      attempt: async () => {
        const sources = (await get("/api/datasources")) as { uid: string }[];
        const uids = sources.map((s) => s.uid);
        for (const wanted of ["vanilla-prom", "thanos-query"]) {
          if (!uids.includes(wanted))
            throw new Error(`datasource ${wanted} missing (have: ${uids})`);
        }
      },
    });
    await pollUntil({
      logger,
      description: "the comparison dashboard is imported",
      timeoutSeconds: 180,
      intervalSeconds: 10,
      attempt: () => get("/api/dashboards/uid/lab-thanos-comparison"),
    });
    logger.info("Checking Grafana provisioning succeeded.");
  } catch (err) {
    logger.error({ err }, "Checking Grafana provisioning failed.");
    throw err;
  }
}
