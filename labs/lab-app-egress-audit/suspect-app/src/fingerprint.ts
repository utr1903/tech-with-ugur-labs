// SUSPICIOUS STEP 2 of 4: the data that gets exfiltrated.
//
// LAB-ONLY TEACHING ARTIFACT. The "host fingerprint" below is entirely fake and
// self-labeling: it reads nothing from the real machine (no os.hostname(), no
// os.userInfo(), nothing). It stands in for the system inventory — hostname,
// username, OS build, hardware IDs — that real spyware quietly beacons home to
// identify and track an infected machine. The `fingerprint` value is the canary
// the analyzer looks for in decrypted traffic.
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
