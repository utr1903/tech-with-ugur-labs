import { describe, expect, it } from "vitest";
import { buildJob } from "./template.js";

const id = "550e8400-e29b-41d4-a716-446655440000";
const config = {
  namespace: "secure-lab",
  image: "worker:local",
  pvcName: "execution-data",
  secure: true,
};
describe("fixed worker Job", () => {
  it("passes only generated id and literal message as configuration data", () => {
    const message = '"; privileged: true\n$(touch /tmp/unsafe)';
    const job = buildJob(config, id, message);
    expect(job.metadata).toMatchObject({
      name: `execution-${id}`,
      namespace: "secure-lab",
    });
    expect(job.spec).toMatchObject({
      backoffLimit: 0,
      activeDeadlineSeconds: 30,
    });
    const pod = job.spec?.template.spec;
    expect(pod?.restartPolicy).toBe("Never");
    expect(job.spec?.template.metadata?.labels).toMatchObject({
      "app.kubernetes.io/component": "worker",
    });
    const worker = pod?.containers[0];
    expect(worker?.image).toBe("worker:local");
    expect(worker?.command).toEqual([
      "/usr/local/bin/node",
      "/opt/worker/launcher.mjs",
    ]);
    expect(
      JSON.parse(
        worker?.env?.find((v) => v.name === "EXECUTION_CONFIG")?.value ?? "",
      ),
    ).toEqual({ id, message });
    expect(worker?.resources?.limits).toEqual({
      cpu: "500m",
      memory: "128Mi",
      "ephemeral-storage": "128Mi",
    });
    expect(worker?.resources?.requests).toEqual({
      cpu: "100m",
      memory: "64Mi",
      "ephemeral-storage": "16Mi",
    });
  });
  it("restricts the secure mount, identity and writable temporary space", () => {
    const pod = buildJob(config, id, "true").spec?.template.spec;
    expect(pod?.automountServiceAccountToken).toBe(false);
    expect(pod?.securityContext).toEqual({
      runAsUser: 10001,
      runAsGroup: 10001,
      runAsNonRoot: true,
      seccompProfile: { type: "RuntimeDefault" },
    });
    expect(pod?.containers[0]?.securityContext).toEqual({
      capabilities: { drop: ["ALL"] },
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
    });
    expect(pod?.containers[0]?.volumeMounts).toEqual([
      { name: "data", mountPath: "/home/runner/data", subPath: `runs/${id}` },
      { name: "tmp", mountPath: "/tmp" },
    ]);
    expect(pod?.volumes).toEqual([
      { name: "data", persistentVolumeClaim: { claimName: "execution-data" } },
      { name: "tmp", emptyDir: { sizeLimit: "64Mi" } },
    ]);
  });
  it("keeps identical images and bounds in the root whole-PVC comparison", () => {
    const secure = buildJob(config, id, "true").spec?.template.spec;
    const exposed = buildJob({ ...config, secure: false }, id, "true").spec
      ?.template.spec;
    expect(exposed?.securityContext).toEqual({ runAsUser: 0, runAsGroup: 0 });
    expect(exposed?.automountServiceAccountToken).toBe(true);
    expect(exposed?.containers[0]?.securityContext).toBeUndefined();
    expect(exposed?.containers[0]?.volumeMounts).toEqual([
      { name: "data", mountPath: "/home/runner/data" },
    ]);
    expect(exposed?.containers[0]?.image).toBe(secure?.containers[0]?.image);
    expect(exposed?.containers[0]?.resources).toEqual(
      secure?.containers[0]?.resources,
    );
    expect(exposed?.hostNetwork).toBeUndefined();
    expect(exposed?.hostPID).toBeUndefined();
    expect(exposed?.hostIPC).toBeUndefined();
  });
});
