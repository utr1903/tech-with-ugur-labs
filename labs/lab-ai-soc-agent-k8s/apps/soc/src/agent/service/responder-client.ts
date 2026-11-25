import { z } from "zod";
import type {
  ActionOutcome,
  ActionProposal,
  ActionRequest,
} from "../../shared/actions.js";

const TIMEOUT_MS = 30_000;

const ResponseSchema = z.object({
  outcomes: z.array(
    z.object({
      proposal: z.custom<ActionProposal>(
        (v) => typeof v === "object" && v !== null,
      ),
      status: z.enum(["executed", "pending_approval", "rejected", "failed"]),
      reason: z.string(),
      approvalId: z.string().optional(),
    }),
  ),
});

export type ResponderClient = {
  send(req: ActionRequest): Promise<ActionOutcome[]>;
};

export function createResponderClient(
  baseUrl: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): ResponderClient {
  return {
    async send(req) {
      const res = await fetchFn(new URL("/actions", baseUrl).toString(), {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Responder returned ${res.status}`);
      return ResponseSchema.parse(await res.json()).outcomes;
    },
  };
}
