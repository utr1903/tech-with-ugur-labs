// SUSPICIOUS STEP: the data that gets exfiltrated.
//
// LAB-ONLY TEACHING ARTIFACT. The "host fingerprint" below is entirely fake and
// self-labeling: it reads nothing from the real machine (no os.hostname(), no
// os.userInfo(), nothing). It stands in for the system inventory real spyware
// beacons home. `fingerprint` is the canary the report ties to the helper.
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
