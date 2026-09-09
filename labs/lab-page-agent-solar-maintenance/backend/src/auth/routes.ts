import { Hono } from "hono";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { signSession } from "./tokens.js";
import { findUser } from "./users.js";

const loginSchema = z.object({ email: z.string(), password: z.string() });

export function authRoutes(config: Config, logger: Logger): Hono {
  const app = new Hono();

  app.post("/login", async (c) => {
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Expected email and password." }, 400);
    const { email, password } = parsed.data;
    try {
      logger.info({ email }, "Logging in...");
      const user = findUser(email, password);
      if (!user) {
        logger.warn({ email }, "Logging in failed: unknown credentials.");
        return c.json({ error: "Unknown email or password." }, 401);
      }
      const token = await signSession(user, config.jwtSecret);
      logger.info({ email, userId: user.id }, "Logging in succeeded.");
      return c.json({ token, user });
    } catch (err) {
      logger.error({ err, email }, "Logging in failed.");
      throw err;
    }
  });

  return app;
}
