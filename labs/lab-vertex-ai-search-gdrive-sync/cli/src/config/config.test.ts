import { describe, expect, it } from "vitest";
import { apiEndpoint, branchPath, loadConfig, servingConfigPath } from "./config.js";

const ENV = {
  GCP_PROJECT_ID: "demo-project",
  GCP_LOCATION: "global",
  GCS_BUCKET: "demo-bucket",
  DATA_STORE_ID: "demo-datastore",
  ENGINE_ID: "demo-app",
  DRIVE_ID: "0ADemoDriveId",
  SYNC_SERVICE_ACCOUNT: "corpus-sync@demo-project.iam.gserviceaccount.com",
};

describe("loadConfig", () => {
  it("reads every value from the environment", () => {
    const config = loadConfig(ENV, "/labs/lab/cli");

    expect(config.projectId).toBe("demo-project");
    expect(config.bucket).toBe("demo-bucket");
    expect(config.dataStoreId).toBe("demo-datastore");
    expect(config.engineId).toBe("demo-app");
    expect(config.driveId).toBe("0ADemoDriveId");
    expect(config.syncServiceAccount).toBe("corpus-sync@demo-project.iam.gserviceaccount.com");
  });

  it("defaults the corpus directory to the lab's corpus folder", () => {
    expect(loadConfig(ENV, "/labs/lab/cli").corpusDir).toBe("/labs/lab/corpus");
  });

  it("keeps the sync manifest inside the cli state directory", () => {
    expect(loadConfig(ENV, "/labs/lab/cli").statePath).toBe("/labs/lab/cli/.state/manifest.json");
  });

  it("keeps the changes token beside the sync manifest", () => {
    expect(loadConfig(ENV, "/labs/lab/cli").changesTokenPath).toBe(
      "/labs/lab/cli/.state/changes-token.json",
    );
  });

  it("honours explicit overrides", () => {
    const config = loadConfig(
      {
        ...ENV,
        CORPUS_DIR: "/tmp/c",
        STATE_PATH: "/tmp/m.json",
        CHANGES_TOKEN_PATH: "/tmp/t.json",
      },
      "/x",
    );

    expect(config.corpusDir).toBe("/tmp/c");
    expect(config.statePath).toBe("/tmp/m.json");
    expect(config.changesTokenPath).toBe("/tmp/t.json");
  });

  it("names the missing variable when one is absent", () => {
    expect(() => loadConfig({ ...ENV, DRIVE_ID: undefined }, "/x")).toThrow(/DRIVE_ID/);
    expect(() => loadConfig({ ...ENV, DRIVE_ID: undefined }, "/x")).toThrow(/deploy_cloud\.sh/);
  });
});

describe("apiEndpoint", () => {
  it("uses the multi-region endpoint outside global", () => {
    expect(apiEndpoint("eu")).toBe("eu-discoveryengine.googleapis.com");
  });

  it("uses the default endpoint for global", () => {
    expect(apiEndpoint("global")).toBe("discoveryengine.googleapis.com");
  });
});

describe("resource paths", () => {
  it("builds the default branch path documents are imported into", () => {
    expect(branchPath(loadConfig(ENV, "/x"))).toBe(
      "projects/demo-project/locations/global/collections/default_collection/dataStores/demo-datastore/branches/default_branch",
    );
  });

  it("builds the serving config path answers are asked of", () => {
    expect(servingConfigPath(loadConfig(ENV, "/x"))).toBe(
      "projects/demo-project/locations/global/collections/default_collection/engines/demo-app/servingConfigs/default_search",
    );
  });
});
