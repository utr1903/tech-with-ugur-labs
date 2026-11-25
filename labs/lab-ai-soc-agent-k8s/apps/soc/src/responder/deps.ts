import type { Logger } from "../logger.js";
import type { ApprovalStore } from "./approvals.js";
import type { AuditTrail } from "./audit-trail.js";
import type { Executor } from "./executor.js";
import type { PolicyConfig } from "./policy.js";
import type { SecretReader } from "./secret-metadata.js";

export type ResponderDeps = {
  logger: Logger;
  policy: PolicyConfig;
  executor: Executor;
  approvals: ApprovalStore;
  audit: AuditTrail;
  secrets: SecretReader;
  /** Bearer token for the agent: POST /actions and GET /secrets. */
  responderToken: string;
  /** Bearer token for the human: approvals and the audit trail. */
  adminToken: string;
};
