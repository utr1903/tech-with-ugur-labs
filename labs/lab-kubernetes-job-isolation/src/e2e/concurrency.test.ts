import { expect, it } from "vitest";
import { summarize } from "./cluster.js";
import { activeCount } from "./concurrency.js";

it("counts actual pending/running pods, excluding completed containers", () => {
  const jobs = ["Pending", "Running", "Succeeded"].map((phase, index) =>
    summarize(
      { metadata: { uid: `${index}`, labels: { "execution-id": `${index}` } } },
      [
        {
          metadata: { labels: { "execution-id": `${index}` } },
          status: { phase },
        },
      ],
    ),
  );
  expect(activeCount(jobs)).toBe(2);
});
