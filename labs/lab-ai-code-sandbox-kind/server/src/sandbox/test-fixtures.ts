// Shared sample capabilities document used across sandbox and agent tests.
// Kept in a plain module (never a .test.ts) so importing it never
// re-registers another file's test suite.
export const sampleCapabilities = {
  pythonVersion: "3.12.14",
  modules: [
    { importName: "numpy", distribution: "numpy", version: "2.5.3" },
    { importName: "sklearn", distribution: "scikit-learn", version: "1.9.1" },
  ],
  limits: {
    executionTimeoutSeconds: 30,
    maxCodeBytes: 65536,
    maxStdoutBytes: 65536,
    maxStderrBytes: 65536,
    maxResultBytes: 65536,
    maxConcurrentExecutions: 20,
  },
  network: "No network use is expected.",
  persistence: "Fresh interpreter every time.",
  structuredResult: "Write result.json.",
};
