import Fastify from "fastify";
import { renderMessage } from "./render.js";

const PORT = Number(process.env.PORT ?? 3000);
const SECURE = process.env.SECURE === "1";
const SECRET_TOKEN = process.env.SECRET_TOKEN ?? "a1b2c3d4";

let currentEmailCss = "";

const app = Fastify();

app.get("/health", async () => ({ ok: true }));

app.post<{ Body: { css?: string } }>("/email", async (req) => {
  currentEmailCss = req.body?.css ?? "";
  return { ok: true };
});

app.get("/message", async (_req, reply) => {
  const { html, headers } = renderMessage({
    token: SECRET_TOKEN,
    emailCss: currentEmailCss,
    secure: SECURE,
  });
  reply.headers(headers);
  reply.type("text/html").send(html);
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => console.log(`webmail listening on ${PORT} (secure=${SECURE})`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
