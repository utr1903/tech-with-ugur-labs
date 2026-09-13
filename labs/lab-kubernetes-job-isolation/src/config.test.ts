import { expect, it } from "vitest";
import { readConfig } from "./config.js";

it("uses fixed administrator configuration and parses explicit secure mode", () => {
  expect(
    readConfig({
      NAMESPACE: "secure-lab",
      WORKER_IMAGE: "worker:local",
      PVC_NAME: "data",
      SECURE_MODE: "true",
      PORT: "3001",
      DATA_ROOT: "/volume",
    }),
  ).toEqual({
    namespace: "secure-lab",
    image: "worker:local",
    pvcName: "data",
    secure: true,
    port: 3001,
    root: "/volume",
  });
});
it.each([
  { NAMESPACE: "unit" },
  {
    NAMESPACE: "unit",
    WORKER_IMAGE: "worker:local",
    PVC_NAME: "data",
    SECURE_MODE: "yes",
  },
  {
    NAMESPACE: "unit",
    WORKER_IMAGE: "worker:local",
    PVC_NAME: "data",
    PORT: "0",
  },
  {
    NAMESPACE: "unit",
    WORKER_IMAGE: "worker:local",
    PVC_NAME: "data",
    DATA_ROOT: "relative",
  },
])("rejects invalid deployment configuration %s", (env) => {
  expect(() => readConfig(env)).toThrow();
});
