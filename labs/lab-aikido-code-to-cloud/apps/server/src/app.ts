import path from "node:path";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Config } from "./config";
import { loginRouter } from "./auth/routes";
import { requireAuth } from "./auth/middleware";
import { integrations } from "./config/integrations";
import { chatRouter } from "./routes/chat";
import type { ChatService } from "./agent/chat";
import { log, requestLogger } from "./logger";

export interface AppDeps {
  config: Config;
  chat?: ChatService;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  log("integrations configured", { slack: integrations.slack.webhookUrl !== "" });

  // INSECURE-BY-DESIGN: reflects any origin with credentials allowed
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(requestLogger);
  // public/ sits at the package root, one level above both src/ and dist/
  app.use(express.static(path.resolve(__dirname, "..", "public")));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(loginRouter());

  if (deps.chat) app.use("/api/chat", requireAuth, chatRouter(deps.chat));

  // INSECURE-BY-DESIGN: error handler returns the stack trace to the client
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message, stack: err.stack });
  });

  return app;
}
