import assert from "node:assert/strict";
import fs from "node:fs";

const orchestratorSource = fs.readFileSync("src/autolist/orchestrator.ts", "utf8");
const publishSource = [
  fs.readFileSync("src/business/publish-from-spu.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/platform-spu-query-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/publish-page-readiness.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/shop-switch-action.ts", "utf8")
].join("\n");
const publishRulesSource = fs.readFileSync("src/business/publish-from-spu/publish-rules.ts", "utf8");
const supervisorSource = fs.readFileSync("src/cli/auto-listing-supervisor.ts", "utf8");

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
const doudianSessionProbeSource = publishSource.slice(
  publishSource.indexOf("export async function assertDoudianPublishSessionReady"),
  publishSource.indexOf("export async function queryPlatformSpu")
);
assert.match(
  doudianSessionProbeSource,
  /try\s*\{[\s\S]*ensurePlatformSpuQueryPageActive[\s\S]*finally\s*\{[\s\S]*context\.browser\(\)\?\.close\(\)/,
  "Every read-only Doudian session probe must disconnect its Playwright CDP client on success and failure"
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
  supervisorSource,
  /isDoudianLoginRequiredFailure[\s\S]*waitForDoudianLoginRecovery[\s\S]*prepareResumeJob/,
  "Supervisor must enter a dedicated login wait and rebuild an exact manifest-backed resume job"
);
assert.match(
  supervisorSource,
  /assertDoudianPublishSessionReady[\s\S]*nextMode = resumePrepared \? "resume" : "full"/,
  "Supervisor must only resume publishing after the fixed headed browser passes a read-only session preflight"
);
assert.match(
  supervisorSource,
  /failedBeforePaidWork[\s\S]*childMode === "full"[\s\S]*preflight/,
  "A login failure at the pre-paid preflight may safely continue the locked full flow after login recovery"
);
assert.doesNotMatch(
  supervisorSource,
  /Doudian login[\s\S]{0,500}(?:password|验证码|手机号).*fill/i,
  "Login recovery must never input credentials or verification codes"
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
