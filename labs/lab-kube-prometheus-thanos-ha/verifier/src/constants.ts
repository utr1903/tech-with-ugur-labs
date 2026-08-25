// Shared fixed facts about the lab cluster, used across commands.

// kind/cluster.yaml provisions 1 control-plane + 2 workers, all running
// node-exporter, so every proof that counts node-exporter targets or
// instances expects exactly this many.
export const NODE_COUNT = 3;
