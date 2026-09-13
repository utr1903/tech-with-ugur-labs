import { expect, it } from "vitest";
import { summarize } from "./cluster.js";
import { forbiddenFeatures, workerBound } from "./live-controls.js";

it("requires worker labels, no retries and measured resource/template bounds on every observed worker", () => {
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
  const evidence = summarize(
    {
      metadata: { uid: "job", labels: { "execution-id": "id" } },
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
          uid: "pod",
          labels: {
            "execution-id": "id",
            "app.kubernetes.io/component": "worker",
          },
        },
        spec,
        status: {
          containerStatuses: [
            {
              name: "worker",
              image: "image",
              imageID: "id",
              ready: false,
              restartCount: 0,
            },
          ],
        },
      },
    ],
  );
  expect(workerBound(evidence)).toBe(true);
  expect(workerBound({ ...evidence, backoffLimit: 1 })).toBe(false);
  expect(workerBound({ ...evidence, pods: [] })).toBe(false);
  expect(
    workerBound({
      ...evidence,
      spec: { ...spec, containers: [{ name: "worker" }] },
    }),
  ).toBe(false);
});

it("rejects host and privileged features in actual pod specifications", () => {
  expect(forbiddenFeatures({ containers: [{ name: "worker" }] })).toBe(false);
  expect(forbiddenFeatures({ containers: [], hostNetwork: true })).toBe(true);
  expect(
    forbiddenFeatures({
      containers: [{ name: "worker", securityContext: { privileged: true } }],
    }),
  ).toBe(true);
  expect(
    forbiddenFeatures({
      containers: [],
      volumes: [{ name: "bad", hostPath: { path: "/" } }],
    }),
  ).toBe(true);
});
