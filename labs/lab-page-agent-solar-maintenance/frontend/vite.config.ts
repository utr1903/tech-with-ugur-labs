import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = process.env.BACKEND_URL ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Everything the browser calls is same-origin. There is no CORS in this
    // lab because there is nothing cross-origin to allow.
    proxy: { "/api": { target: backend, changeOrigin: true } },
  },
});
