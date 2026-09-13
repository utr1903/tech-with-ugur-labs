import { readFileSync } from "node:fs";
import {
  loadYaml,
  type V1Deployment,
  type V1Service,
} from "@kubernetes/client-node";
import { expect, it } from "vitest";

it("deploys a bounded fixture whose service selects the listening pod", () => {
  const docs = readFileSync("deploy/fixture.yaml", "utf8").split(/^---\s*$/m);
  const deployment = loadYaml<V1Deployment>(docs[1] ?? "");
  const service = loadYaml<V1Service>(docs[2] ?? "");
  expect(deployment.kind).toBe("Deployment");
  expect(service.kind).toBe("Service");
  expect(deployment.metadata?.namespace).toBe("download-fixture");
  expect(service.metadata?.namespace).toBe("download-fixture");
  expect(service.spec?.selector).toEqual(
    deployment.spec?.template.metadata?.labels,
  );
  const container = deployment.spec?.template.spec?.containers[0];
  expect(container?.image).toBe(
    "lab-kubernetes-job-isolation-fixture:local-v1",
  );
  expect(container?.readinessProbe).toEqual({ tcpSocket: { port: 8080 } });
  expect(service.spec?.ports).toEqual([{ port: 8080, targetPort: 8080 }]);
  expect(container?.securityContext).toEqual({
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem: true,
    capabilities: { drop: ["ALL"] },
  });
  expect(deployment.spec?.template.spec?.automountServiceAccountToken).toBe(
    false,
  );
  expect(container?.resources?.limits).toEqual({
    cpu: "100m",
    memory: "64Mi",
    "ephemeral-storage": "16Mi",
  });
});
