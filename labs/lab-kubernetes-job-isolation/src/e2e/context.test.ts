import { expect, it } from "vitest";
import { summarize } from "./cluster.js";
import { mergeJobs } from "./context.js";

it("keeps observed pod UID evidence when foreground deletion removes the named pod", () => {
  const job = { metadata: { uid: "job", labels: { "execution-id": "id" } } };
  const old = summarize(job, [
    { metadata: { uid: "pod", labels: { "execution-id": "id" } } },
  ]);
  const merged = mergeJobs(new Map([["job", old]]), [summarize(job, [])]);
  expect(merged.get("job")?.pods[0]?.uid).toBe("pod");
});
