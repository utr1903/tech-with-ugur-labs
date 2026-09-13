import { createServer, type RequestListener } from "node:http";
import { afterEach, expect, it } from "vitest";
import { post } from "./http.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function endpoint(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Listener missing.");
  return `http://127.0.0.1:${address.port}`;
}
it("sends only POST execute with exact JSON and preserves real response bytes", async () => {
  let request = "";
  const url = await endpoint((req, res) => {
    req.on("data", (bytes) => {
      request += bytes;
    });
    req.on("end", () => {
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/execute");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "id", exitCode: 7, output: "stderr\n" }));
    });
  });
  expect(
    await post(url, JSON.stringify({ message: "printf test" }), 1000),
  ).toEqual({
    status: 200,
    body: { id: "id", exitCode: 7, output: "stderr\n" },
  });
  expect(JSON.parse(request)).toEqual({ message: "printf test" });
});
it("bounds an unresponsive endpoint", async () => {
  const url = await endpoint(() => {});
  const started = Date.now();
  await expect(post(url, "{}", 30)).rejects.toThrow();
  expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  expect(Date.now() - started).toBeLessThan(500);
});
