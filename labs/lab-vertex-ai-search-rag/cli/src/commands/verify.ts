import { branchPath, type LabConfig, servingConfigPath } from "../config/config.js";
import { type CorpusDocument, corpusUri, loadCorpus } from "../corpus/documents.js";
import { ABSTENTION_QUESTION, CROSS_DOCUMENT_PROBE, POSITIVE_PROBES } from "../corpus/probes.js";
import type { Logger } from "../logger.js";
import { askQuestion } from "../search/answer.js";
import { conversationalClient, documentClient } from "../search/clients.js";
import {
  type Check,
  checkAbstains,
  checkCitesAll,
  checkCitesOnly,
  checkContainsFact,
  checkDocumentCount,
  checkGrounded,
  checkOmitsFact,
  summarize,
} from "../verify/checks.js";
import { writeLine } from "./output.js";

const GROUNDING_THRESHOLD = Number(process.env.GROUNDING_THRESHOLD ?? 0.6);
const ABSTENTION_THRESHOLD = Number(process.env.ABSTENTION_THRESHOLD ?? 0.3);

function uriFor(docs: CorpusDocument[], bucket: string, docId: string): string {
  const doc = docs.find((candidate) => candidate.id === docId);
  if (doc === undefined) {
    throw new Error(`Probe references unknown document ${docId}.`);
  }
  return corpusUri(bucket, doc);
}

export async function runVerify(config: LabConfig, logger: Logger): Promise<number> {
  const docs = await loadCorpus(config.corpusDir);
  const [indexed] = await documentClient(config).listDocuments({
    parent: branchPath(config),
    pageSize: 100,
  });
  const client = conversationalClient(config);
  const servingConfig = servingConfigPath(config);
  const checks: Check[] = [checkDocumentCount("documents indexed", indexed.length, docs.length)];

  for (const probe of POSITIVE_PROBES) {
    const result = await askQuestion(client, servingConfig, probe.question, {}, logger);
    const uri = uriFor(docs, config.bucket, probe.docId);
    checks.push(
      checkContainsFact(`${probe.docId}: answer carries the invented fact`, result, probe.fact),
      checkCitesOnly(`${probe.docId}: cites its source document`, result, uri),
      checkGrounded(`${probe.docId}: answer is grounded`, result, GROUNDING_THRESHOLD),
    );
  }

  for (const probe of POSITIVE_PROBES) {
    const result = await askQuestion(
      client,
      servingConfig,
      probe.question,
      { withoutRetrieval: true },
      logger,
    );
    checks.push(
      checkOmitsFact(`${probe.docId}: the fact is unknown without retrieval`, result, probe.fact),
    );
  }

  const abstention = await askQuestion(client, servingConfig, ABSTENTION_QUESTION, {}, logger);
  checks.push(
    checkAbstains("abstains on a topic outside the corpus", abstention, ABSTENTION_THRESHOLD),
  );

  const crossDocument = await askQuestion(
    client,
    servingConfig,
    CROSS_DOCUMENT_PROBE.question,
    {},
    logger,
  );
  checks.push(
    checkCitesAll(
      "cites both documents it had to combine",
      crossDocument,
      CROSS_DOCUMENT_PROBE.docIds.map((docId) => uriFor(docs, config.bucket, docId)),
    ),
    ...CROSS_DOCUMENT_PROBE.facts.map((fact, index) =>
      checkContainsFact(`cross-document fact ${index + 1}`, crossDocument, fact),
    ),
  );

  for (const check of checks) {
    writeLine(`${check.passed ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`);
  }

  const summary = summarize(checks);
  writeLine("");
  writeLine(`${summary.total - summary.failed}/${summary.total} checks passed.`);
  return summary.ok ? 0 : 1;
}
