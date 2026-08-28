import express, { type Router } from "express";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { chat } from "../model/ollama-client.js";
import { createAssistantHandler } from "./assistant.js";
import { createProcessHandler } from "./process.js";

export interface RouterDeps {
  config: AppConfig;
  logger: Logger;
  chatFn?: (prompt: string) => Promise<string>;
  fetchFn?: typeof fetch;
  execFn?: (cmd: string) => Promise<{ stdout: string; stderr: string }>;
}

export function createRouter(deps: RouterDeps): Router {
  const { config, logger, fetchFn, execFn } = deps;
  const chatFn =
    deps.chatFn ??
    ((prompt: string) =>
      chat(
        { baseUrl: config.ollamaBaseUrl, model: config.ollamaModel, logger },
        prompt,
      ));

  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.post(
    "/assistant",
    createAssistantHandler({ config, logger, chatFn, fetchFn }),
  );
  router.post(
    "/process",
    createProcessHandler({ config, logger, chatFn, execFn }),
  );

  return router;
}
