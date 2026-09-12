import { Hono } from "hono";
import type { Pool } from "pg";
import type { ThreadService } from "../threads/service.js";
import { chatRoutes } from "./chat.js";
import { localAddress } from "./localhost.js";
export function createApp(service: ThreadService, pool: Pool) {
	const app = new Hono();
	let requests = 0;
	app.use("*", async (c, next) => {
		const origin = c.req.header("Origin");
		if (!localAddress(c.req.url) || (origin && !localAddress(origin)))
			return c.json({ error: "Localhost access only." }, 403);
		if (requests >= 32) return c.json({ error: "Request limit reached." }, 429);
		requests++;
		try {
			if (origin) c.header("Access-Control-Allow-Origin", origin);
			c.header("Vary", "Origin");
			c.header("Cache-Control", "no-store");
			await next();
		} finally {
			requests--;
		}
	});
	app.options("*", (c) => {
		c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		c.header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");
		return c.body(null, 204);
	});
	app.onError(
		() =>
			new Response(
				JSON.stringify({
					error: "Request rejected or temporarily unavailable.",
				}),
				{ status: 409, headers: { "content-type": "application/json" } },
			),
	);
	app.get("/health", async (c) => {
		await pool.query("SELECT 1");
		return c.json({ status: "ok" });
	});
	app.post("/threads", async (c) => c.json(await service.create(), 201));
	app.get("/threads", async (c) => c.json({ threads: await service.list() }));
	app.get("/threads/:id/messages", async (c) =>
		c.json(await service.history(c.req.param("id"))),
	);
	chatRoutes(app, service);
	return app;
}
