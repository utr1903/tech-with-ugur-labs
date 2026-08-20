// LAB-ONLY TEACHING ARTIFACT. The "host fingerprint" below is entirely fake and
// self-labeling: it reads nothing from the real machine. It stands in for the
// system inventory that real spyware quietly beacons home.
export type HostFingerprint = {
  host: string;
  user: string;
  osBuild: string;
  fingerprint: string;
};

export function buildFingerprint(): HostFingerprint {
  return {
    host: "LAB-CANARY-NOT-A-REAL-HOST",
    user: "labuser",
    osBuild: "lab-os-0",
    fingerprint: "FAKE-FP-000-lab-only",
  };
}
