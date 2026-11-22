import fs from "node:fs";
import path from "node:path";
import { inspectMainImageCollage, isMainImageCollageRejectionReason } from "./main-image-collage-action.js";
import { recordPaidImageCompleted } from "./paid-image-submission-ledger.js";

export async function recoverRejectedCollageFalsePositive(options: {
  productDir: string;
  slot: number;
  failureReason: string;
  providerTaskId: string;
}): Promise<boolean> {
  if (!isMainImageCollageRejectionReason(options.failureReason) || !options.providerTaskId) return false;
  const evidenceMatch = /(?:^|;\s*)evidence=(.+)$/u.exec(options.failureReason);
  if (!evidenceMatch) return false;
  const evidenceDir = path.resolve(evidenceMatch[1]);
  const expectedRoot = path.resolve(
    options.productDir,
    "rejected-collage",
    `slot-${String(options.slot).padStart(2, "0")}`
  );
  if (evidenceDir !== expectedRoot && !evidenceDir.startsWith(`${expectedRoot}${path.sep}`)) return false;
  const candidates = fs.existsSync(evidenceDir)
    ? fs.readdirSync(evidenceDir)
        .filter((name) => /\.(?:png|jpe?g|webp)$/iu.test(name))
        .map((name) => path.join(evidenceDir, name))
    : [];
  if (candidates.length !== 1) return false;
  const inspection = await inspectMainImageCollage(candidates[0]);
  if (inspection.collageDetected) return false;
  recordPaidImageCompleted({
    productDir: options.productDir,
    slot: options.slot,
    sourceFile: candidates[0],
    providerTaskId: options.providerTaskId,
    rejectedResultRecovery: {
      expectedFailureReason: options.failureReason,
      reason: "Recovered provider result after corrected single-poster detector proved the archived output is not a collage."
    }
  });
  return true;
}
