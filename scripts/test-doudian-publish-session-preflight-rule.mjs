import assert from "node:assert/strict";
import fs from "node:fs";

const orchestratorSource = fs.readFileSync("src/autolist/orchestrator.ts", "utf8");
const publishSource = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");
const publishRulesSource = fs.readFileSync("src/business/publish-from-spu/publish-rules.ts", "utf8");

assert.match(
  publishRulesSource,
  /export function isDoudianLoginPageText/,
  "Doudian login-page detection must live in the publish rule layer"
);

assert.match(
  publishSource,
  /export async function assertDoudianPublishSessionReady/,
  "Publish module must expose a reusable Doudian publish session preflight"
);

assert.match(
  publishSource,
  /isDoudianLoginPageText/,
  "Publish browser checks must use rule-layer Doudian login-page detection"
);

assert.match(
  orchestratorSource,
  /shouldPreflightDoudianPublishSession/,
  "Auto-listing orchestrator must decide whether a real run needs Doudian publish preflight"
);

assert.match(
  orchestratorSource,
  /Checking Doudian login preflight before paid image generation/,
  "Real auto-listing must report the pre-image Doudian check as login preflight, not as publish progress"
);

assert.doesNotMatch(
  orchestratorSource,
  /Checking Doudian publish browser login before paid image generation/,
  "Hermes-visible progress must not make the pre-image login check look like actual publishing"
);

assert.match(
  orchestratorSource,
  /assertDoudianPublishSessionReady/,
  "Real auto-listing must call Doudian publish session preflight before task execution"
);

console.log("doudian publish session preflight rule passed");
