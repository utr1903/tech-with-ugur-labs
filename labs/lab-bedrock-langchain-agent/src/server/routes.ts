import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { AnswerQuestion } from "../agent/answer.js";
import { describeError } from "../agent/describe-error.js";
import { findModel, MODEL_KEYS, type ModelEntry } from "../agent/models.js";
import type { Logger } from "../logger.js";
import { toHttpError } from "./http-error.js";

/** What the routes need from the rest of the app. */
export type ServerDeps = { answerQuestion: AnswerQuestion; logger: Logger };

const querySchema = z.object({
  model: z.string().min(1).max(50),
  query: z.string().trim().min(1).max(500),
});

const INVALID_REQUEST = {
  error: {
    code: "INVALID_REQUEST",
    message:
      'Send JSON like {"model": "kimi-k3", "query": "..."}; "query" must be 1 to 500 characters.',
  },
};

/** Reads the body as JSON; a body that is not JSON reads as undefined. */
async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** A validated request, or the response to send back for an invalid one. */
type ParsedQuery =
  | { ok: true; entry: ModelEntry; query: string }
  | { ok: false; response: Response };

/**
 * Validates the body and resolves the model. Kept apart from `createRoutes`
 * so each function stays short and does one thing.
 */
async function parseQueryRequest(request: Request): Promise<ParsedQuery> {
  const parsed = querySchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return {
      ok: false,
      response: Response.json(INVALID_REQUEST, { status: 400 }),
    };
  }
  const entry = findModel(parsed.data.model);
  if (!entry) {
    return {
      ok: false,
      response: Response.json(
        {
          error: {
            code: "UNKNOWN_MODEL",
            message: `Unknown model "${parsed.data.model}".`,
          },
          validModels: MODEL_KEYS,
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, entry, query: parsed.data.query };
}

/** Runs one question through the agent and shapes the response, win or fail. */
async function runQuery({
  answerQuestion,
  logger,
  entry,
  query,
}: ServerDeps & { entry: ModelEntry; query: string }): Promise<Response> {
  const requestLogger = logger.child({
    requestId: randomUUID(),
    model: entry.key,
  });
  const startedAt = Date.now();
  try {
    requestLogger.info({ queryLength: query.length }, "Answering question...");
    const { answer, toolCalls } = await answerQuestion({
      entry,
      query,
      logger: requestLogger,
    });
    const durationMs = Date.now() - startedAt;
    requestLogger.info(
      { toolCalls: toolCalls.length, durationMs },
      "Answering question succeeded.",
    );
    return Response.json({ answer, model: entry.key, toolCalls, durationMs });
  } catch (err) {
    // Deliberately not re-thrown: this is the boundary where an error
    // becomes a response. Logged in reduced form, see describeError.
    const httpError = toHttpError(err);
    requestLogger.error(
      {
        ...describeError(err),
        code: httpError.code,
        durationMs: Date.now() - startedAt,
      },
      "Answering question failed.",
    );
    return Response.json(
      { error: { code: httpError.code, message: httpError.message } },
      { status: httpError.status },
    );
  }
}

/** The two routes of the lab. */
export function createRoutes({ answerQuestion, logger }: ServerDeps): Hono {
  const routes = new Hono();

  // Reachable only after migrations and seeding, because the server starts
  // listening last. See src/index.ts.
  routes.get("/readyz", (c) => c.json({ status: "ready" }));

  routes.post("/query", async (c) => {
    const parsed = await parseQueryRequest(c.req.raw);
    if (!parsed.ok) {
      return parsed.response;
    }
    return runQuery({
      answerQuestion,
      logger,
      entry: parsed.entry,
      query: parsed.query,
    });
  });

  return routes;
}
