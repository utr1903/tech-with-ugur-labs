// Runs once when a new Next.js server instance starts, before it handles any
// request — the one sound place in this app to install process-wide error
// handlers (a route module has no equivalent single entrypoint).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installGlobalErrorHandlers, logger } = await import("./lib/logger");
    installGlobalErrorHandlers(logger);
  }
}
