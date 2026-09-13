import { Server } from "node:http";
import { serve } from "@hono/node-server";
import { BatchV1Api, KubeConfig } from "@kubernetes/client-node";
import { createApp } from "./api/app.js";
import { readConfig } from "./config.js";
import { KubernetesExecutionService } from "./execution/service.js";
import { KubernetesJobClient } from "./kubernetes/client.js";
import { operation } from "./lib/operation.js";
import { createLogger, installGlobalErrorHandlers } from "./logger.js";
import { FileExecutionStore } from "./storage/store.js";

const logger = createLogger({ appName: "kubernetes-job-isolation" });
installGlobalErrorHandlers(logger);
await operation(logger, "Start server", {}, async () => {
  const config = readConfig();
  const kube = new KubeConfig();
  kube.loadFromCluster();
  const store = new FileExecutionStore({
    root: config.root,
    secure: config.secure,
    logger,
  });
  await store.initialize();
  const jobs = new KubernetesJobClient(
    kube.makeApiClient(BatchV1Api),
    config,
    logger,
  );
  const service = new KubernetesExecutionService(store, jobs, logger);
  const app = createApp(service, logger);
  const server = serve({ fetch: app.fetch, port: config.port });
  if (server instanceof Server) server.requestTimeout = 60000;
  const maintenance = setInterval(() => {
    service.sweep().catch(() => process.exit(1));
  }, 60000);
  maintenance.unref();
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      logger.info({ signal }, "Stop server...");
      clearInterval(maintenance);
      server.close(() => {
        logger.info({}, "Stop server succeeded.");
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 5000).unref();
    });
});
