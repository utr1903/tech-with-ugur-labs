import type { V1Job, V1PodSpec } from "@kubernetes/client-node";
export type JobConfig = {
  namespace: string;
  image: string;
  pvcName: string;
  secure: boolean;
};

export function buildJob(
  config: JobConfig,
  id: string,
  message: string,
): V1Job {
  const labels = {
    "app.kubernetes.io/component": "worker",
    "execution-id": id,
  };
  const pod: V1PodSpec = {
    restartPolicy: "Never",
    serviceAccountName: "worker",
    automountServiceAccountToken: !config.secure,
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
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 30,
      ttlSecondsAfterFinished: 3600,
      template: { metadata: { labels }, spec: pod },
    },
  };
}
