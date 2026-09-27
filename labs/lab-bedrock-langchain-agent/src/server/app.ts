import { Hono } from "hono";
import { describeError } from "../agent/describe-error.js";
import { INTERNAL_ERROR } from "./http-error.js";
import { createRoutes, type ServerDeps } from "./routes.js";

/**
 * Assembles the HTTP app. Unknown paths and unexpected errors answer in the
 * same error shape as the routes, so a client handles one format only.
 * `onError` is a last resort for anything that escapes the routes (a bug in
 * Hono's own dispatch, for example): it only logs one failure line and
 * answers with the shared internal-error response, never a stack trace.
 */
export function createApp(deps: ServerDeps): Hono {
  const app = new Hono();
  app.route("/", createRoutes(deps));
  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "No such route." } }, 404),
  );
  app.onError((err, c) => {
    deps.logger.error(describeError(err), "Handling request failed.");
    return c.json(
      { error: { code: INTERNAL_ERROR.code, message: INTERNAL_ERROR.message } },
      INTERNAL_ERROR.status,
    );
  });
  return app;
}
