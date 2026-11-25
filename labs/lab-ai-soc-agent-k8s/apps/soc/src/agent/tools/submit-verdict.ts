import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { VerdictSchema } from "../../shared/verdict.js";
import { runLogged, ToolFailure } from "./tool-run.js";
import type { InvestigationState, ToolDeps } from "./types.js";

const MAX_VERDICTS = { investigate: 1, hunt: 10 } as const;

const DESCRIPTION = `Submit your final verdict with evidence. Investigations accept exactly one verdict; hunts accept up to ${MAX_VERDICTS.hunt}, one per finding. Include the ids of every response proposal you made in proposal_ids; the responder only considers proposals listed here.
Use for: finishing the investigation once you have enough evidence, or concluding benign/inconclusive when you do not.
Do NOT use for: asking questions, or intermediate notes (write those in your reply text).`;

export function buildSubmitVerdict(deps: ToolDeps, state: InvestigationState) {
  return betaZodTool({
    name: "submit_verdict",
    description: DESCRIPTION,
    inputSchema: VerdictSchema,
    run: (verdict) =>
      runLogged(
        deps.logger,
        "submit_verdict",
        { verdict: verdict.verdict, proposals: verdict.proposal_ids },
        async () => {
          if (state.verdicts.length >= MAX_VERDICTS[state.mode]) {
            throw new ToolFailure(
              "verdict_limit",
              `A ${state.mode} accepts at most ${MAX_VERDICTS[state.mode]} verdict(s); yours was not recorded.`,
            );
          }
          const known = new Set(state.proposals.map((p) => p.id));
          const unknown = verdict.proposal_ids.filter((id) => !known.has(id));
          if (unknown.length > 0) {
            throw new ToolFailure(
              "unknown_proposal",
              `proposal_ids not recorded: ${unknown.join(", ")}.`,
            );
          }
          state.verdicts.push(verdict);
          return JSON.stringify({ accepted: true });
        },
      ),
  });
}
