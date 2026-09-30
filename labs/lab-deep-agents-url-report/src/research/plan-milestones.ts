import { z } from "zod";

const taskSchema = z.object({
  label: z.enum([
    "Read supplied pages",
    "Select relevant articles",
    "Crawl site",
    "Search additional sources",
    "Validate evidence",
    "Write report",
    "Research task",
  ]),
  status: z.enum(["pending", "in_progress", "completed"]),
});
export type PlanTask = z.infer<typeof taskSchema>;
const todoSchema = z.object({
  content: z.string(),
  status: taskSchema.shape.status,
});
const labels: [RegExp, PlanTask["label"]][] = [
  [/\b(?:read|review|inspect)\b/i, "Read supplied pages"],
  [/\b(?:select|selection|relevant|relevance)\b/i, "Select relevant articles"],
  [/\bcrawl\b/i, "Crawl site"],
  [/\b(?:search|discover|discovery)\b/i, "Search additional sources"],
  [/\b(?:validate|verify|citations?|evidence)\b/i, "Validate evidence"],
  [/\b(?:write|draft|report|summarize|synthesize)\b/i, "Write report"],
];

// Never copy model prose: milestones use only this fixed public task vocabulary.
export function summarizePlanTasks(todos: unknown[]): PlanTask[] {
  return todos.slice(0, 12).flatMap((value) => {
    const parsed = todoSchema.safeParse(value);
    if (!parsed.success) return [];
    const label =
      labels.find(([pattern]) => pattern.test(parsed.data.content))?.[1] ??
      "Research task";
    return [{ label, status: parsed.data.status }];
  });
}

// Recheck the allowlist at the output boundary, even for already recorded ledger data.
export function publicPlanTasks(tasks: unknown): PlanTask[] {
  if (!Array.isArray(tasks)) return [];
  return tasks.slice(0, 12).flatMap((value) => {
    const parsed = taskSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}
