import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

type Container = {
  image: string;
  env: { name: string; value: string }[];
  readinessProbe: unknown;
  volumeMounts: unknown;
};
type PodSpec = {
  serviceAccountName: string;
  automountServiceAccountToken: boolean;
  securityContext: unknown;
  containers: [Container];
  volumes: unknown;
};
type Manifest = {
  kind: string;
  metadata: { name: string; namespace?: string };
  spec?: { template: { spec: PodSpec } };
  rules?: unknown[];
  subjects?: unknown[];
};
function render(secure: boolean): Manifest[] {
  const result = spawnSync(
    "helm",
    [
      "template",
      secure ? "secure" : "insecure",
      "deploy/chart",
      "--namespace",
      secure ? "secure" : "insecure",
      "--set",
      `secure=${secure}`,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout
    .split(/^---\s*$/m)
    .map((part) => part.replace(/^#.*$/gm, "").trim())
    .filter(Boolean)
    .map((part) => JSON.parse(part));
}
describe("rendered release isolation", () => {
  it.each([false, true])(
    "keeps API privileges namespace scoped and separates storage: secure=%s",
    (secure) => {
      const docs = render(secure);
      expect(docs.some((doc) => doc.kind.startsWith("Cluster"))).toBe(false);
      const role = docs.find((doc) => doc.kind === "Role");
      expect(role?.rules).toEqual([
        {
          apiGroups: ["batch"],
          resources: ["jobs"],
          verbs: ["create", "get", "list", "watch", "delete"],
        },
        {
          apiGroups: [""],
          resources: ["pods"],
          verbs: ["get", "list", "watch"],
        },
      ]);
      const binding = docs.find((doc) => doc.kind === "RoleBinding");
      expect(binding?.subjects).toEqual([
        {
          kind: "ServiceAccount",
          name: "server",
          namespace: secure ? "secure" : "insecure",
        },
      ]);
      expect(
        docs.filter((doc) => doc.kind === "PersistentVolumeClaim"),
      ).toHaveLength(1);
      expect(
        docs.find((doc) => doc.kind === "PersistentVolumeClaim")?.metadata.name,
      ).toBe("execution-data");
      expect(
        docs
          .filter((doc) => doc.kind === "ServiceAccount")
          .map((doc) => doc.metadata.name)
          .sort(),
      ).toEqual(["server", "worker"]);
      const spec = docs.find((doc) => doc.kind === "Deployment")?.spec?.template
        .spec;
      if (!spec) throw new Error("Missing server Deployment");
      expect(spec.serviceAccountName).toBe("server");
      expect(spec.automountServiceAccountToken).toBe(true);
      expect(spec.securityContext).toEqual({ runAsUser: 0, runAsGroup: 0 });
      expect(spec.containers[0].readinessProbe).toEqual({
        tcpSocket: { port: 3000 },
        initialDelaySeconds: 1,
        periodSeconds: 2,
      });
      expect(spec.containers[0].volumeMounts).toEqual([
        { name: "data", mountPath: "/data" },
      ]);
      expect(spec.containers[0].env).toContainEqual({
        name: "SECURE_MODE",
        value: String(secure),
      });
      expect(spec.volumes).toEqual([
        {
          name: "data",
          persistentVolumeClaim: { claimName: "execution-data" },
        },
      ]);
      const policy = docs.find((doc) => doc.kind === "NetworkPolicy");
      if (secure)
        expect(policy?.spec).toEqual({
          podSelector: {
            matchLabels: { "app.kubernetes.io/component": "worker" },
          },
          policyTypes: ["Ingress", "Egress"],
          ingress: [],
          egress: [],
        });
      else expect(policy).toBeUndefined();
    },
  );
  it("uses identical application and worker images across both modes", () => {
    const images = [false, true].map((secure) => {
      const container = render(secure).find((doc) => doc.kind === "Deployment")
        ?.spec?.template.spec.containers[0];
      if (!container) throw new Error("Missing server image");
      return container;
    });
    const [insecure, secure] = images;
    if (!insecure || !secure) throw new Error("Missing release");
    expect(insecure.image).toBe("lab-kubernetes-job-isolation-server:local-v1");
    expect(secure.image).toBe(insecure.image);
    expect(
      insecure.env.find((item) => item.name === "WORKER_IMAGE")?.value,
    ).toBe("lab-kubernetes-job-isolation-worker:local-v1");
    expect(secure.env.find((item) => item.name === "WORKER_IMAGE")).toEqual(
      insecure.env.find((item) => item.name === "WORKER_IMAGE"),
    );
  });
});
