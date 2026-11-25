import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertMainImageIsSinglePoster,
  isMainImageCollageRejectionReason,
  MAIN_IMAGE_COLLAGE_GATE_VERSION,
  MAIN_IMAGE_COLLAGE_REJECTION_CODE,
  MAIN_IMAGE_COLLAGE_RETRY_EXHAUSTED_CODE,
  MAIN_IMAGE_SINGLE_POSTER_PROMPT_CONTRACT,
  resolveMainImageCollageRetry
} from "../dist/src/autolist/main-image-collage-action.js";
import { buildImageEditPromptFromWord } from "../dist/src/autolist/main-image-provider-action.js";
import { buildMainImageProductionPrompt } from "../dist/src/autolist/main-image-visual-direction-rules.js";
import { recoverRejectedCollageFalsePositive } from "../dist/src/autolist/main-image-collage-recovery-action.js";
import {
  isCanonicalRawMainImageFileName,
  quarantineRecoveredMainImageCollage
} from "../dist/src/autolist/main-image-assets.js";
import {
  initializePaidImageProductLedger,
  readPaidImageSlotRecord,
  recordPaidImageCompleted,
  recordPaidImageFailedAfterAcceptance,
  recordPaidImageSubmitted,
  reservePaidImageSlot
} from "../dist/src/autolist/paid-image-submission-ledger.js";
import { shouldResumeFeishuBatchAfterRetryableChildFailure } from "../dist/src/autolist/batch-continuation-rules.js";
import { getPythonCommand, sanitizePythonRuntimeEnv } from "../dist/src/utils/platform.js";

assert.match(MAIN_IMAGE_SINGLE_POSTER_PROMPT_CONTRACT, /单张完整海报/u);
assert.match(MAIN_IMAGE_SINGLE_POSTER_PROMPT_CONTRACT, /禁止.*(?:四宫格|4合1|拼图)/u);
assert.equal(isMainImageCollageRejectionReason(`${MAIN_IMAGE_COLLAGE_REJECTION_CODE}: rejected`), true);
assert.deepEqual(resolveMainImageCollageRetry({ audit: [
  { state: "failed_after_acceptance", reason: `${MAIN_IMAGE_COLLAGE_REJECTION_CODE}: one` },
  { state: "failed_after_acceptance", reason: `${MAIN_IMAGE_COLLAGE_REJECTION_CODE}: two` }
] }), { retry: true, rejectedOutputCount: 2, maxOutputs: 3 });
assert.deepEqual(resolveMainImageCollageRetry({ audit: [1, 2, 3].map((value) => ({
  state: "failed_after_acceptance",
  reason: `${MAIN_IMAGE_COLLAGE_REJECTION_CODE}: ${value}`
})) }), { retry: false, rejectedOutputCount: 3, maxOutputs: 3 });
assert.equal(isCanonicalRawMainImageFileName("generated-03.png"), true);
assert.equal(isCanonicalRawMainImageFileName("generated-03.png.unframed.png"), false);
assert.equal(isCanonicalRawMainImageFileName("generated-03.png.frame-ready.png"), false);
assert.equal(shouldResumeFeishuBatchAfterRetryableChildFailure({
  exitCode: 1,
  batchComplete: false,
  retryableFailureMessage: `${MAIN_IMAGE_COLLAGE_RETRY_EXHAUSTED_CODE}: slot 15`,
  recoveryAttempts: 0,
  maxRecoveryAttempts: 12
}), false);
const variablePrompt = buildImageEditPromptFromWord({
  paragraphs: ["产品卖点", "地点类别：office。海报提示词"],
  promptWordFile: "prompt.docx"
});
const prompt = buildMainImageProductionPrompt({
  basePromptText: variablePrompt,
  roundIndex: 0,
  variantIndex: 0,
  hasFixedFrame: false
});
assert.match(prompt, /单张完整海报/u);
assert.match(prompt, /禁止.*(?:四宫格|4合1|拼图)/u);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "main-image-collage-"));
const collageFile = path.join(tempDir, "four-panel.png");
const singlePosterFile = path.join(tempDir, "single-poster.png");
const modularPosterFile = path.join(tempDir, "modular-single-poster.png");
const fixtureScript = [
  "from PIL import Image, ImageDraw",
  "import sys",
  "collage=Image.new('RGB',(800,800),'white')",
  "d=ImageDraw.Draw(collage)",
  "colors=[(232,210,190),(196,224,246),(225,238,205),(214,204,242)]",
  "boxes=[(0,0,394,394),(406,0,800,394),(0,406,394,800),(406,406,800,800)]",
  "for i,(box,color) in enumerate(zip(boxes,colors)):",
  "    d.rectangle(box,fill=color)",
  "    x1,y1,x2,y2=box",
  "    d.rectangle((x1+60,y1+150,x2-40,y2-65),fill=(250,250,250),outline=(70,40,130),width=8)",
  "    d.rectangle((x1+25,y1+30,x2-25,y1+85),fill=(80+i*20,45,120))",
  "collage.save(sys.argv[1])",
  "single=Image.new('RGB',(800,800))",
  "p=single.load()",
  "for y in range(800):",
  "    for x in range(800): p[x,y]=(235-int(35*y/800),245-int(25*x/800),250-int(20*(x+y)/1600))",
  "d=ImageDraw.Draw(single)",
  "d.ellipse((70,80,730,720),fill=(225,235,245),outline=(150,170,200),width=6)",
  "d.rectangle((190,300,610,620),fill=(252,252,252),outline=(75,45,135),width=10)",
  "d.rectangle((120,110,680,200),fill=(88,48,132))",
  "single.save(sys.argv[2])",
  "poster=Image.new('RGB',(800,800),(225,205,175))",
  "d=ImageDraw.Draw(poster)",
  "d.rectangle((0,0,800,85),fill=(248,238,215))",
  "d.rectangle((30,100,390,430),fill=(154,55,36))",
  "d.rectangle((455,80,690,610),fill=(245,245,238),outline=(180,40,30),width=8)",
  "d.ellipse((35,465,280,710),fill=(198,135,115),outline=(245,205,80),width=10)",
  "d.rectangle((0,650,800,800),fill=(238,215,170))",
  "for x in (110,330,550): d.ellipse((x,675,x+130,795),fill=(185,125,105),outline=(245,205,80),width=8)",
  "poster.save(sys.argv[3])"
].join("\n");
execFileSync(getPythonCommand(), ["-c", fixtureScript, collageFile, singlePosterFile, modularPosterFile], {
  env: sanitizePythonRuntimeEnv(process.env)
});

const accepted = await assertMainImageIsSinglePoster({ imageFile: singlePosterFile });
assert.equal(accepted.collageDetected, false);
assert.equal(accepted.gateVersion, MAIN_IMAGE_COLLAGE_GATE_VERSION);
const acceptedModularPoster = await assertMainImageIsSinglePoster({ imageFile: modularPosterFile });
assert.equal(acceptedModularPoster.collageDetected, false);
await assert.rejects(
  () => assertMainImageIsSinglePoster({ imageFile: collageFile }),
  /collage|四宫格|拼图/iu
);
assert.ok(fs.existsSync(`${collageFile}.collage-rejected.json`));

const ledger = initializePaidImageProductLedger({
  rootDir: path.join(tempDir, "ledger"),
  batchFingerprint: "batch-collage-recovery",
  recordId: "record-collage-recovery",
  expectedSlotCount: 1,
  providerIdentity: "provider-test",
  sourceImageDigest: "source-test"
});
assert.equal(reservePaidImageSlot({
  productDir: ledger.productDir,
  slot: 1,
  requestDigest: "request-digest",
  promptDigest: "prompt-digest",
  owner: { pid: process.pid }
}).action, "submit");
recordPaidImageSubmitted({ productDir: ledger.productDir, slot: 1, providerTaskId: "task-collage" });
recordPaidImageCompleted({
  productDir: ledger.productDir,
  slot: 1,
  providerTaskId: "task-collage",
  sourceFile: collageFile
});
const quarantine = quarantineRecoveredMainImageCollage({
  rawImageFile: collageFile,
  paidImageProductLedgerDir: ledger.productDir,
  slot: 1
});
assert.equal(readPaidImageSlotRecord({ productDir: ledger.productDir, slot: 1 }).state, "failed_after_acceptance");
assert.equal(fs.existsSync(collageFile), false);
assert.ok(fs.existsSync(path.join(quarantine.archiveDir, "paid-result.png")));
assert.ok(fs.existsSync(path.join(quarantine.archiveDir, "slot-record.json")));
assert.ok(fs.existsSync(path.join(quarantine.archiveDir, "runtime-files", "four-panel.png")));

const falsePositiveLedger = initializePaidImageProductLedger({
  rootDir: path.join(tempDir, "false-positive-ledger"),
  batchFingerprint: "batch-false-positive",
  recordId: "record-false-positive",
  expectedSlotCount: 1,
  providerIdentity: "provider-test",
  sourceImageDigest: "source-test"
});
reservePaidImageSlot({
  productDir: falsePositiveLedger.productDir,
  slot: 1,
  requestDigest: "request-digest",
  promptDigest: "prompt-digest",
  owner: { pid: process.pid }
});
recordPaidImageSubmitted({
  productDir: falsePositiveLedger.productDir,
  slot: 1,
  providerTaskId: "task-false-positive"
});
const falsePositiveEvidenceDir = path.join(falsePositiveLedger.productDir, "rejected-collage", "slot-01", "attempt-01");
fs.mkdirSync(falsePositiveEvidenceDir, { recursive: true });
fs.copyFileSync(modularPosterFile, path.join(falsePositiveEvidenceDir, "generated-01.png"));
const falsePositiveReason = `${MAIN_IMAGE_COLLAGE_REJECTION_CODE}: provider output failed the single-poster gate; evidence=${falsePositiveEvidenceDir}`;
recordPaidImageFailedAfterAcceptance({
  productDir: falsePositiveLedger.productDir,
  slot: 1,
  providerTaskId: "task-false-positive",
  reason: falsePositiveReason,
  providerResponse: { id: "task-false-positive", status: "completed" }
});
assert.equal(await recoverRejectedCollageFalsePositive({
  productDir: falsePositiveLedger.productDir,
  slot: 1,
  failureReason: falsePositiveReason,
  providerTaskId: "task-false-positive"
}), true);
const falsePositiveRecovered = readPaidImageSlotRecord({ productDir: falsePositiveLedger.productDir, slot: 1 });
assert.equal(falsePositiveRecovered.state, "completed");
assert.ok(fs.existsSync(falsePositiveRecovered.resultFile));

const assetsSource = fs.readFileSync("src/autolist/main-image-assets.ts", "utf8");
const providerSource = fs.readFileSync("src/autolist/main-image-provider-action.ts", "utf8");
assert.match(
  providerSource,
  /retry_failed_after_acceptance[\s\S]*recoverRejectedCollageFalsePositive[\s\S]*resolvePaidImageSlotAction/u,
  "A corrected false-positive rejection must be restored before any fixed-slot retry is reserved."
);
assert.match(
  assetsSource,
  /recoverExistingRoundOutputs[\s\S]*assertMainImageIsSinglePoster[\s\S]*ensureSquareMainImageFile/u,
  "Recovered raw images must pass the no-collage gate before reuse."
);
assert.match(
  assetsSource,
  /generationResults[\s\S]*assertMainImageIsSinglePoster[\s\S]*ensureSquareMainImageFile[\s\S]*applyLocalWatermark/u,
  "New provider results must pass the no-collage gate before normalization, framing, or watermarking."
);
const squareActionSource = fs.readFileSync("src/autolist/main-image-square-action.ts", "utf8");
assert.match(
  squareActionSource,
  /repairMainImageArtifactShapes[\s\S]*assertMainImageIsSinglePoster/u,
  "Publish-stage resume must revalidate image content before browser publishing."
);
const fingerprintSource = fs.readFileSync("src/autolist/business-rule-fingerprint.ts", "utf8");
assert.match(fingerprintSource, /MAIN_IMAGE_COLLAGE_GATE_VERSION/u);
const auditSource = fs.readFileSync("src/cli/audit-auto-listing.ts", "utf8");
assert.match(
  auditSource,
  /durableCompletedEvidence[\s\S]*businessRuleFingerprint === businessRuleFingerprint/u,
  "Historical completed evidence may prove a closed past batch but must not enter current-rule artifact audits."
);
assert.match(
  auditSource,
  /runState\.status !== "completed"[\s\S]*runState\.businessRuleFingerprint !== businessRuleFingerprint/u,
  "A completed historical run must not be treated as a resumable obsolete runtime after a rule upgrade."
);

fs.rmSync(tempDir, { recursive: true, force: true });
console.log("main image no-collage rules passed");
