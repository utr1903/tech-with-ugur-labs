import { resolve } from "node:path";

export interface LabConfig {
  projectId: string;
  location: string;
  bucket: string;
  dataStoreId: string;
  engineId: string;
  driveId: string;
  syncServiceAccount: string;
  corpusDir: string;
  statePath: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing ${name}. Run ./scripts/deploy_cloud.sh — it writes cli/.env for you.`);
  }
  return value;
}

/** `cliDir` is the cli directory itself: <lab>/cli. */
export function loadConfig(env: NodeJS.ProcessEnv, cliDir: string): LabConfig {
  return {
    projectId: required(env, "GCP_PROJECT_ID"),
    location: required(env, "GCP_LOCATION"),
    bucket: required(env, "GCS_BUCKET"),
    dataStoreId: required(env, "DATA_STORE_ID"),
    engineId: required(env, "ENGINE_ID"),
    driveId: required(env, "DRIVE_ID"),
    syncServiceAccount: required(env, "SYNC_SERVICE_ACCOUNT"),
    corpusDir: env.CORPUS_DIR ?? resolve(cliDir, "..", "corpus"),
    statePath: env.STATE_PATH ?? resolve(cliDir, ".state", "manifest.json"),
  };
}

export function apiEndpoint(location: string): string {
  return location === "global"
    ? "discoveryengine.googleapis.com"
    : `${location}-discoveryengine.googleapis.com`;
}

function collectionPath(config: LabConfig): string {
  return `projects/${config.projectId}/locations/${config.location}/collections/default_collection`;
}

export function branchPath(config: LabConfig): string {
  return `${collectionPath(config)}/dataStores/${config.dataStoreId}/branches/default_branch`;
}

export function servingConfigPath(config: LabConfig): string {
  return `${collectionPath(config)}/engines/${config.engineId}/servingConfigs/default_search`;
}
