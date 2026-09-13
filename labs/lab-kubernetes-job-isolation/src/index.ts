import { Server } from "node:http";
import { serve } from "@hono/node-server";
import { BatchV1Api, KubeConfig } from "@kubernetes/client-node";
import { createApp } from "./api/app.js";
import { readConfig } from "./config.js";
import { KubernetesExecutionService } from "./execution/service.js";
import { KubernetesJobClient } from "./kubernetes/client.js";
import { safeProcessError } from "./lib/errors.js";
import { operation } from "./lib/operation.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { FileExecutionStore } from "./storage/store.js";

const logger = createLogger({ appName: "kubernetes-job-isolation" });
installGlobalErrorHandlers(logger);
// Complete storage initialization before accepting requests that can create workers.
await operation(logger, "Start server", {}, async () => {
  const config = readConfig();
  const appLogger = logger.child({
    namespace: config.namespace,
    secure: config.secure,
  });
  const kube = new KubeConfig();
  // Use the server Pod identity; submitted commands cannot select Kubernetes credentials.
  kube.loadFromCluster();
  const store = new FileExecutionStore({
    root: config.root,
    secure: config.secure,
    logger: appLogger,
  });
  await store.initialize();
  const jobs = new KubernetesJobClient(
    kube.makeApiClient(BatchV1Api),
    config,
    appLogger,
  );
  const service = new KubernetesExecutionService(store, jobs, appLogger);
  const app = createApp(service, appLogger);
  const server = serve({ fetch: app.fetch, port: config.port });
  if (server instanceof Server) server.requestTimeout = 60000;
  // Prune known completed executions periodically even when no new request arrives.
  const maintenance = setInterval(() => {
    service.sweep().catch(() => process.exit(1));
  }, 60000);
  maintenance.unref();
  // Stop admitting HTTP requests on shutdown, with a bounded fallback for stalled connections.
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      try {
        appLogger.info({ signal }, "Stop server...");
        clearInterval(maintenance);
        server.close((err?: Error) => {
          if (err)
            appLogger.error(
              { signal, err: safeProcessError(err) },
              "Stop server failed.",
            );
          else appLogger.info({ signal }, "Stop server succeeded.");
          process.exit(err ? 1 : 0);
        });
        setTimeout(() => {
          appLogger.error(
            {
              signal,
              timeoutMs: 5000,
              reason: "Connections did not close in time",
            },
            "Stop server failed.",
          );
          process.exit(1);
        }, 5000).unref();
      } catch (err) {
        appLogger.error(
          { signal, err: safeProcessError(err) },
          "Stop server failed.",
        );
        process.exit(1);
      }
    });
});
