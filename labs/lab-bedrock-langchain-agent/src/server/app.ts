import { Hono } from "hono";
import { describeError } from "../agent/describe-error.js";
import { createRoutes, type ServerDeps } from "./routes.js";

/**
 * Assembles the HTTP app. Unknown paths and unexpected errors answer in the
 * same error shape as the routes, so a client handles one format only.
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
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "The request failed unexpectedly. See `make logs`.",
        },
      },
      500,
    );
  });
  return app;
}
