import Fastify, { FastifyInstance } from "fastify";

// 1x1 transparent GIF so the browser's image request succeeds.
const GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

interface Leak {
  phase: string;
  pos: number;
  c: string;
}

export function buildCollector(): FastifyInstance {
  const app = Fastify();
  const leaks: Leak[] = [];

  app.get("/health", async () => ({ ok: true }));

  app.get<{ Querystring: { phase?: string; pos?: string; c?: string } }>(
    "/leak",
    async (req, reply) => {
      const { phase = "", pos = "0", c = "" } = req.query;
      leaks.push({ phase, pos: Number(pos), c });
      reply.type("image/gif").send(GIF);
    },
  );

  app.get<{ Querystring: { phase?: string; pos?: string } }>(
    "/events",
    async (req) => {
      const phase = req.query.phase ?? "";
      const pos = Number(req.query.pos ?? 0);
      const chars = leaks
        .filter((l) => l.phase === phase && l.pos === pos)
        .map((l) => l.c);
      return { chars };
    },
  );

  app.get<{ Querystring: { phase?: string } }>("/count", async (req) => {
    const phase = req.query.phase ?? "";
    return { count: leaks.filter((l) => l.phase === phase).length };
  });

  app.post<{ Body: { phase?: string } }>("/reset", async (req) => {
    const phase = req.body?.phase ?? "";
    for (let i = leaks.length - 1; i >= 0; i--) {
      if (leaks[i].phase === phase) leaks.splice(i, 1);
    }
    return { ok: true };
  });

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const PORT = Number(process.env.PORT ?? 4000);
  const app = buildCollector();
  app
    .listen({ port: PORT, host: "0.0.0.0" })
    .then(() => console.log(`collector listening on ${PORT}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
