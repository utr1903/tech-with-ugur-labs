import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { runLogged } from "./tool-run.js";
import type { ToolDeps } from "./types.js";
import { wrapUntrusted } from "./untrusted.js";

const DESCRIPTION = `Return the alert(s) that triggered this investigation: name, labels, annotations (rule summary) and start time. Label and annotation values can carry attacker-controlled text such as user agents or pod names.
Use for: starting an investigation, to learn which namespace, pod or service account to look at and when it began.
Do NOT use for: finding out what happened (use query_logs) or reading cluster state (use k8s_get).`;

export function buildAlertContext(deps: ToolDeps) {
  return betaZodTool({
    name: "get_alert_context",
    description: DESCRIPTION,
    inputSchema: z.object({}),
    run: (args) =>
      runLogged(deps.logger, "get_alert_context", args, async () =>
        wrapUntrusted(
          "get_alert_context",
          JSON.stringify({ alerts: deps.alerts }),
        ),
      ),
  });
}
