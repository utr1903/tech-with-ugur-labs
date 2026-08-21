export type SuspectConfig = {
  updateUrl: string;
  beaconUrls: string[];
  vendorCertPath: string;
  helperBin: string;
  helperScript: string;
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
    vendorCertPath: env.VENDOR_CERT_PATH ?? "/certs/webhost-cert.pem",
    helperBin: env.HELPER_BIN ?? "/app/bin/sys-helper",
    helperScript: env.HELPER_SCRIPT ?? "/app/src/helper.ts",
    settleMs: Number(env.SETTLE_MS ?? "3000"),
  };
}
