import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyPublishFailure } from "../dist/src/business/publish-from-spu/publish-rules.js";
import { recordPublishFailure } from "../dist/src/autolist/failure-circuit-breaker.js";
import { compactStatusLine } from "../dist/src/cli/auto-listing-controller-runtime.js";

const missingExactOption = "No spec template option exactly matched Feishu value: 买一送一";
assert.equal(
  classifyPublishFailure(missingExactOption),
  "spec_template_configuration_missing",
  "a missing exact Feishu template option must be a user-remediated configuration blocker"
);
assert.deepEqual(
  recordPublishFailure(
    { signature: "", consecutive: 0, open: false },
    { stage: "publish", errorClass: classifyPublishFailure(missingExactOption) }
  ),
  { signature: "publish:spec_template_configuration_missing", consecutive: 1, open: true },
  "a missing exact option must stop the batch immediately before later targets"
);
assert.equal(
  compactStatusLine(`Publish failed: ${missingExactOption}`),
  "没有对应的规格模板可选",
  "Hermes-facing status must contain only the requested remediation message"
);

const continuationRules = fs.readFileSync("src/autolist/batch-continuation-rules.ts", "utf8");
const statusRules = fs.readFileSync("src/autolist/spec-template-status-rules.ts", "utf8");
assert.match(statusRules, /No spec template option exactly matched Feishu value/, "the status rule must recognize exact-option absence");
assert.match(statusRules, /没有对应的规格模板可选/, "the status rule must preserve the concise Hermes message");
assert.match(continuationRules, /resolveMissingSpecTemplateHermesMessage/, "continuation status must consume the dedicated rule");

console.log("Feishu specification-template contract passed");
