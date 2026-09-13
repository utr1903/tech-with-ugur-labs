import { expect, it } from "vitest";
import { summarize } from "./cluster.js";
import { completeCoverage, retentionBound } from "./retention.js";

it("requires all130 returned IDs to retain historical Job/Pod identities and controls, including the pruned first pair", () => {
  const ids = Array.from({ length: 130 }, (_, index) => `id-${index}`);
  const spec = {
    containers: [
      {
        name: "worker",
        resources: {
          requests: {
            cpu: "100m",
            memory: "64Mi",
            "ephemeral-storage": "16Mi",
          },
          limits: {
            cpu: "500m",
            memory: "128Mi",
            "ephemeral-storage": "128Mi",
          },
        },
      },
    ],
    restartPolicy: "Never",
  };
  const jobs = ids.map((id) =>
    summarize(
      {
        metadata: { uid: `job-${id}`, labels: { "execution-id": id } },
        spec: {
          backoffLimit: 0,
          activeDeadlineSeconds: 30,
          ttlSecondsAfterFinished: 3600,
          template: { spec },
        },
      },
      [
        {
          metadata: {
            uid: `pod-${id}`,
            labels: {
              "execution-id": id,
              "app.kubernetes.io/component": "worker",
            },
          },
          spec,
          status: {
            containerStatuses: [
              {
                name: "worker",
                image: "image",
                imageID: "image-id",
                ready: false,
                restartCount: 0,
              },
            ],
          },
        },
      ],
    ),
  );
  expect(completeCoverage(ids, jobs)).toBe(true);
  expect(completeCoverage(ids, jobs.slice(2))).toBe(false);
  expect(
    completeCoverage(
      ids,
      jobs.map((job, index) => (index === 0 ? { ...job, pods: [] } : job)),
    ),
  ).toBe(false);
  expect(
    completeCoverage(
      ids,
      jobs.map((job, index) =>
        index === 0 ? { ...job, backoffLimit: 1 } : job,
      ),
    ),
  ).toBe(false);
  const first = jobs[0];
  if (!first) throw new Error("Test fixture missing.");
  expect(completeCoverage(ids, [...jobs.slice(0, 129), first])).toBe(false);
  expect(completeCoverage([...ids.slice(0, 129), undefined], jobs)).toBe(false);
});

it("requires successful real executions beyond the cap, retained exact bound and actual sentinel removal", () => {
  expect(retentionBound(130, 128, false, false)).toBe(true);
  expect(retentionBound(5, 5, false, false)).toBe(false);
  expect(retentionBound(130, 129, false, false)).toBe(false);
  expect(retentionBound(130, 128, true, false)).toBe(false);
  expect(retentionBound(130, 128, false, true)).toBe(false);
});
