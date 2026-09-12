import { createLogger, installGlobalErrorHandlers } from "../logger";
import { refresh } from "./refresh";

const logger = createLogger();
installGlobalErrorHandlers(logger);
await refresh(process.env.BACKEND_URL ?? "http://backend:3001", logger);
