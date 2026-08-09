import fs from "node:fs";
import path from "node:path";
import { verifyPublishedProductInDoudianList } from "../business/publish-from-spu/product-list-verification-action.js";
import { readPublishAttemptState } from "./publish-attempt-state.js";
import { atomicWriteJson } from "../utils/atomic-file.js";

const MIN_REVIEW_AGE_MS = 10 * 60 * 1000;

export interface UncertainPublishRecoveryResult {
  runtimeDir: string;
  resultFile: string;
  archiveFile: string;
  title: string;
  shopFolder: string;
  countText: string;
  screenshotFile: string;
}

export async function approveReviewedNegativeUncertainPublishRetry(input: {
  runtimeDir: string;
  shopFolder: string;
  now?: () => number;
  verify?: typeof verifyPublishedProductInDoudianList;
}): Promise<UncertainPublishRecoveryResult> {
  const resultFile = path.join(input.runtimeDir, "result.json");
  if (!fs.existsSync(resultFile)) throw new Error(`Uncertain publish result is missing: ${resultFile}`);
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8")) as Record<string, any>;
  const browser = result.data?.browser || {};
  const title = String(result.data?.metadata?.title || "").trim();
  const canonicalIdentity = result.data?.metadata?.canonicalIdentity;
  const resultShopFolder = String(result.data?.shopFolder || "");
  if (browser.publishClickAttempted !== true || browser.publishClicked === true) {
    throw new Error("Recovery requires one attempted but unconfirmed publish click.");
  }
  if (!/success signal was not observed|no submission success signal/i.test(
    `${result.message || ""} ${browser.publishIssue || ""}`
  )) {
    throw new Error("Recovery result is not a final-submit uncertainty.");
  }
  if (!title) throw new Error("Recovery requires the exact generated title from the publish result.");
  if (!canonicalIdentity || typeof canonicalIdentity !== "object") {
    throw new Error("Recovery requires the canonical publish identity from the publish result.");
  }
  if (path.resolve(resultShopFolder) !== path.resolve(input.shopFolder)) {
    throw new Error(`Recovery shop mismatch: expected=${resultShopFolder}; actual=${input.shopFolder}`);
  }
  if (readPublishAttemptState(input.runtimeDir) !== "attempted_or_unknown") {
    throw new Error("Recovery requires an attempted_or_unknown durable submit boundary.");
  }
  const finishedAt = Date.parse(String(result.finishedAt || ""));
  const now = input.now?.() ?? Date.now();
  if (!Number.isFinite(finishedAt) || now - finishedAt < MIN_REVIEW_AGE_MS) {
    throw new Error("Recovery requires an uncertainty older than ten minutes.");
  }
  const priorNegativeScreenshots = fs.existsSync(path.join(input.runtimeDir, "screenshots"))
    ? fs.readdirSync(path.join(input.runtimeDir, "screenshots"))
      .filter((name) => /doudian-list-full-title-.*-not-found\.png$/.test(name))
    : [];
  if (priorNegativeScreenshots.length === 0) {
    throw new Error("Recovery requires a prior stable exact-title not-found screenshot.");
  }

  const verification = await (input.verify || verifyPublishedProductInDoudianList)({
    runtimeDir: input.runtimeDir,
    shopFolder: input.shopFolder,
    title
  });
  if (verification.found || !/^共\s*0\s*条$/.test(verification.countText)) {
    throw new Error(`Recovery live verification was not a stable zero result: found=${verification.found}; count=${verification.countText || "missing"}.`);
  }

  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const archiveDir = path.join(input.runtimeDir, "manual-recovery", stamp);
  fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: false });
  const archiveFile = path.join(archiveDir, "result.before-review.json");
  fs.copyFileSync(resultFile, archiveFile);
  const evidenceFile = path.join(archiveDir, "review-evidence.json");
  atomicWriteJson(evidenceFile, {
    reviewedAt: new Date(now).toISOString(),
    type: "operator_reviewed_stable_negative_list_verification",
    title,
    canonicalIdentity,
    shopFolder: input.shopFolder,
    priorNegativeScreenshots,
    liveVerification: verification
  });
  result.manualRecovery = {
    type: "operator_reviewed_stable_negative_list_verification",
    approved: true,
    approvedAt: new Date(now).toISOString(),
    title,
    canonicalIdentity,
    shopFolder: input.shopFolder,
    countText: verification.countText,
    screenshotFile: verification.screenshotFile,
    evidenceFile
  };
  atomicWriteJson(resultFile, result);
  return {
    runtimeDir: input.runtimeDir,
    resultFile,
    archiveFile,
    title,
    shopFolder: input.shopFolder,
    countText: verification.countText,
    screenshotFile: verification.screenshotFile
  };
}
