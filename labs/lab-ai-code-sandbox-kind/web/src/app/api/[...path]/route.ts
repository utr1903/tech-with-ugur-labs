import { logger } from "../../../lib/logger";
import { createServerProxy } from "../../../lib/server-proxy";

export const dynamic = "force-dynamic";

const forwardToServer = createServerProxy({ logger });

export const GET = forwardToServer;
export const POST = forwardToServer;
