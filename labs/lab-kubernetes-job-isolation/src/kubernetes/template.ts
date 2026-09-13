import type { V1Job, V1PodSpec } from "@kubernetes/client-node";
export type JobConfig = {
  namespace: string;
  image: string;
  pvcName: string;
  secure: boolean;
};

// Build the fixed operator-owned template: the request contributes only its ID and shell text.
export function buildJob(
  config: JobConfig,
  id: string,
  message: string,
): V1Job {
  // Apply worker selectors to both Job and Pod so the network policy reaches actual executions.
  const labels = {
    "app.kubernetes.io/component": "worker",
    "execution-id": id,
  };
  const pod: V1PodSpec = {
    restartPolicy: "Never",
    serviceAccountName: "worker",
    automountServiceAccountToken: !config.secure,
    // Secure identity is enforced by Kubernetes rather than the worker image default alone.
    securityContext: config.secure
      ? {
          runAsUser: 10001,
          runAsGroup: 10001,
          runAsNonRoot: true,
          seccompProfile: { type: "RuntimeDefault" },
        }
      : { runAsUser: 0, runAsGroup: 0 },
    containers: [
      {
        name: "worker",
        image: config.image,
        imagePullPolicy: "IfNotPresent",
        command: ["/usr/local/bin/node", "/opt/worker/launcher.mjs"],
        env: [
          { name: "EXECUTION_CONFIG", value: JSON.stringify({ id, message }) },
          { name: "HOME", value: "/home/runner" },
          { name: "OUTPUT_LIMIT_BYTES", value: "65536" },
        ],
        // Bound scheduling and consumption in both modes; these limits are not complete DoS protection.
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
        // Secure workers see one server-selected subPath instead of the whole release PVC.
        volumeMounts: config.secure
          ? [
              {
                name: "data",
                mountPath: "/home/runner/data",
                subPath: `runs/${id}`,
              },
              { name: "tmp", mountPath: "/tmp" },
            ]
          : [{ name: "data", mountPath: "/home/runner/data" }],
        ...(config.secure
          ? {
              securityContext: {
                capabilities: { drop: ["ALL"] },
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
              },
            }
          : {}),
      },
    ],
    volumes: [
      { name: "data", persistentVolumeClaim: { claimName: config.pvcName } },
      ...(config.secure
        ? [{ name: "tmp", emptyDir: { sizeLimit: "64Mi" } }]
        : []),
    ],
  };
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: `execution-${id}`, namespace: config.namespace, labels },
    // Disable retries and independently bound active lifetime and completed resource retention.
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 30,
      ttlSecondsAfterFinished: 3600,
      template: { metadata: { labels }, spec: pod },
    },
  };
}
