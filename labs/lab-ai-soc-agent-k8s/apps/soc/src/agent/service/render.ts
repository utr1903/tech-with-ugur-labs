import type { Verdict } from "../../shared/verdict.js";
import type { Report } from "./reports.js";

/** Inline text: one line, markdown punctuation escaped. */
function inline(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[\\`*[\]<>|#~]/g, "\\$&")
    .trim();
}

/** Multi-line text in a fence longer than any backtick run inside it. */
function fenced(text: string): string {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((m) => m.length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

function renderVerdict(v: Verdict, index: number): string[] {
  const out = [
    `## Verdict ${index + 1}: ${v.verdict} (confidence ${v.confidence})`,
    "",
    fenced(v.summary),
    "",
  ];
  if (v.injection_suspected) {
    out.push(
      "**Prompt injection suspected.**",
      "",
      fenced(v.injection_evidence ?? "(no evidence given)"),
      "",
    );
  }
  out.push("### Techniques", "");
  for (const t of v.attack_techniques) {
    out.push(`- ${inline(t.id)} ${inline(t.name)}`);
  }
  out.push("", "### Timeline", "");
  out.push(
    fenced(
      v.timeline.map((e) => `${e.time} [${e.source}] ${e.event}`).join("\n"),
    ),
    "",
    "### Affected",
    "",
  );
  for (const a of v.affected) {
    const path = a.namespace ? `${a.namespace}/${a.name}` : a.name;
    out.push(`- ${inline(a.kind)} ${inline(path)}`);
  }
  out.push("");
  return out;
}

function renderOutcomes(r: Report): string[] {
  const out = ["## Proposals and outcomes", ""];
  if (r.proposals.length === 0 && r.outcomes.length === 0) {
    return [...out, "No actions were proposed.", ""];
  }
  const byId = new Map(r.outcomes.map((o) => [o.proposal.id, o]));
  for (const p of r.proposals) {
    const o = byId.get(p.id);
    const target = [p.target.namespace, p.target.name]
      .filter(Boolean)
      .join("/");
    out.push(
      `- ${inline(p.id)}: ${inline(p.kind)} on ${inline(target)}`,
      `  - reason: ${inline(p.reason)}`,
      o
        ? `  - outcome: ${o.status} - ${inline(o.reason)}${o.approvalId ? ` (approval ${inline(o.approvalId)})` : ""}`
        : "  - outcome: none recorded",
    );
  }
  return [...out, ""];
}

/** A human-readable report; every model-written string is fenced or escaped. */
export function renderMarkdown(r: Report): string {
  const lines = [
    `# Report ${inline(r.id)}`,
    "",
    `- mode: ${r.mode}`,
    `- created: ${r.createdAt}`,
    `- finished: ${r.finishedAt}`,
    `- model: ${inline(r.model)}`,
    `- alerts: ${r.alerts.map((a) => inline(a.alertname)).join(", ") || "none"}`,
  ];
  if (r.relatedTo) lines.push(`- related to: ${inline(r.relatedTo)}`);
  lines.push("");
  r.verdicts.forEach((v, i) => {
    lines.push(...renderVerdict(v, i));
  });
  lines.push(...renderOutcomes(r));
  lines.push(
    "## Usage",
    "",
    `- stop reason: ${inline(r.stopReason)}`,
    `- budget exhausted: ${r.budgetExhausted}`,
    ...Object.entries(r.usage).map(([k, v]) => `- ${k}: ${v}`),
    "",
  );
  return lines.join("\n");
}
