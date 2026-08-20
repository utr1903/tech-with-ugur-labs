export type SuspectConfig = {
  updateUrl: string;
  beaconUrls: string[];
  pinnedUrl: string;
  mitmCaPath: string;
  pinnedCertPath: string;
  settleMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv): SuspectConfig {
  return {
    updateUrl: env.UPDATE_URL ?? "https://updates.goodvendor.lab/version",
    beaconUrls: (
      env.BEACON_URLS ??
      "https://cdn-metrics.tracklab.lab/beacon,https://telemetry.adnexus.lab/collect"
    )
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean),
    pinnedUrl: env.PINNED_URL ?? "https://pin.evil-c2.lab/checkin",
    mitmCaPath: env.MITM_CA_PATH ?? "/certs/mitmproxy-ca-cert.pem",
    pinnedCertPath: env.PINNED_CERT_PATH ?? "/certs/webhost-cert.pem",
    settleMs: Number(env.SETTLE_MS ?? "2000"),
  };
}
