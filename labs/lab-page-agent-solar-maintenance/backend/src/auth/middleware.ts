import type { MiddlewareHandler } from "hono";
import { type SessionUser, verifySession } from "./tokens.js";

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser;
  }
}

export function requireAuth(secret: string): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : "";
    if (token === "") return c.json({ error: "Missing session token." }, 401);
    try {
      c.set("user", await verifySession(token, secret));
    } catch {
      return c.json({ error: "Invalid session token." }, 401);
    }
    await next();
  };
}
