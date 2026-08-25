import type { Config } from "./config.js";
import type { Kubectl } from "./kube/kubectl.js";
import type { Logger } from "./logger.js";
import type { PromClient } from "./prom/client.js";

export type Ctx = {
  cfg: Config;
  logger: Logger;
  vanilla: PromClient;
  thanos: PromClient;
  shard0: PromClient;
  shard1: PromClient;
  kube: Kubectl;
};
