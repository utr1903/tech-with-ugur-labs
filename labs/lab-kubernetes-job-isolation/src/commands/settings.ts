import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Resolve reader commands from this lab location rather than the invoking shell directory.
export const root = fileURLToPath(new URL("../..", import.meta.url));
export const context = "kind-job-isolation";
export const cluster = "job-isolation";
export const images = [
  "lab-kubernetes-job-isolation-server:local-v1",
  "lab-kubernetes-job-isolation-worker:local-v1",
  "lab-kubernetes-job-isolation-fixture:local-v1",
];
// Keep the tool, node-image and CNI pins in the checked-in deployment manifest.
export const versions: {
  kindVersion: string;
  kindNodeImage: string;
  helmVersion: string;
  kubectlVersion: string;
  cniChart: string;
  cniChartVersion: string;
} = JSON.parse(readFileSync(`${root}/deploy/versions.json`, "utf8"));
