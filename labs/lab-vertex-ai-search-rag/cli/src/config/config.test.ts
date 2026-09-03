import { describe, expect, it } from "vitest";
import { apiEndpoint, branchPath, loadConfig, servingConfigPath } from "./config.js";

const ENV = {
  GCP_PROJECT_ID: "demo-project",
  GCP_LOCATION: "global",
  GCS_BUCKET: "demo-bucket",
  DATA_STORE_ID: "demo-datastore",
  ENGINE_ID: "demo-app",
};

describe("loadConfig", () => {
  it("reads every value from the environment", () => {
    const config = loadConfig(ENV, "/labs/cli/src/config");

    expect(config.projectId).toBe("demo-project");
    expect(config.location).toBe("global");
    expect(config.bucket).toBe("demo-bucket");
    expect(config.dataStoreId).toBe("demo-datastore");
    expect(config.engineId).toBe("demo-app");
  });

  it("defaults the corpus directory to the sibling corpus folder", () => {
    const config = loadConfig(ENV, "/labs/lab/cli/src/config");

    expect(config.corpusDir).toBe("/labs/lab/corpus");
  });

  it("honours an explicit corpus directory", () => {
    const config = loadConfig({ ...ENV, CORPUS_DIR: "/tmp/corpus" }, "/labs/lab/cli/src/config");

    expect(config.corpusDir).toBe("/tmp/corpus");
  });

  it("names the missing variable when one is absent", () => {
    expect(() => loadConfig({ ...ENV, ENGINE_ID: undefined }, "/x")).toThrow(/ENGINE_ID/);
    expect(() => loadConfig({ ...ENV, ENGINE_ID: undefined }, "/x")).toThrow(/deploy_cloud\.sh/);
  });
});

describe("apiEndpoint", () => {
  it("uses the multi-region endpoint outside global", () => {
    expect(apiEndpoint("eu")).toBe("eu-discoveryengine.googleapis.com");
    expect(apiEndpoint("us")).toBe("us-discoveryengine.googleapis.com");
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
