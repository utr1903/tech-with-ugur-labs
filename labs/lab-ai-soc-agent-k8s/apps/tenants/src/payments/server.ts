import { createServer, type Server } from "node:http";
import type { Queryable } from "../db/pool.js";
import type { Logger } from "../logger.js";

interface CustomerRow {
  id: number;
  name: string;
  card_last4: string;
}

export function createPaymentsServer(logger: Logger, pool: Queryable): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const path = new URL(req.url ?? "/", "http://payments.local").pathname;
    try {
      if (path === "/healthz") return send(200, { ok: true });
      const match = /^\/customers\/(\d+)$/.exec(path);
      if (!match) return send(404, { error: "not found" });
      const id = Number(match[1]);
      logger.info({ id }, "Looking up customer...");
      const { rows } = await pool.query<CustomerRow>(
        "SELECT id, name, card_last4 FROM customers WHERE id = $1",
        [id],
      );
      const row = rows[0];
      logger.info(
        { id, found: row !== undefined },
        "Looking up customer succeeded.",
      );
      if (!row) return send(404, { error: "no such customer" });
      return send(200, {
        id: row.id,
        name: row.name,
        card_last4: row.card_last4,
      });
    } catch (err) {
      logger.error({ err, path }, "Looking up customer failed.");
      return send(500, { error: "internal error" });
    }
  });
}

export function startPaymentsServer(
  logger: Logger,
  pool: Queryable,
  port: number,
): void {
  createPaymentsServer(logger, pool).listen(port, () =>
    logger.info({ port }, "Starting payments-api succeeded."),
  );
}
