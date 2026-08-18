import http from "node:http";
import { handleRequest, type RouteDeps } from "./routes.js";

export function createAppServer(deps: RouteDeps): http.Server {
  return http.createServer((req, res) => {
    void handleRequest(deps, req, res);
  });
}
