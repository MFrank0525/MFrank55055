export interface LocalVisionRuntimeMigrationInput {
  currentBatchFingerprint: string;
  runtimeBatchFingerprint: string;
  currentBusinessRuleFingerprint: string;
  runtimeBusinessRuleFingerprint: string;
  taskStatus: string;
  failedStep: string;
  failureMessage: string;
  generatedImageCount: number;
  paidCompletedCount: number;
  paidUnsafeCount: number;
  publishManifestEntryCount: number;
}

export function assertLocalVisionRuntimeMigrationEligible(input: LocalVisionRuntimeMigrationInput): void {
  if (!input.currentBatchFingerprint || input.runtimeBatchFingerprint !== input.currentBatchFingerprint) {
    throw new Error("Local vision runtime migration requires the exact current Feishu batch.");
  }
  if (!input.currentBusinessRuleFingerprint || input.runtimeBusinessRuleFingerprint === input.currentBusinessRuleFingerprint) {
    throw new Error("Local vision runtime migration requires an obsolete runtime business-rule fingerprint.");
  }
  if (input.taskStatus !== "failed" || input.failedStep !== "main_images_generated") {
    throw new Error("Local vision runtime migration requires a failed main_images_generated task.");
  }
  if (input.failureMessage !== "Local vision scene audit returned no response content.") {
    throw new Error("Local vision runtime migration only accepts the legacy empty-response failure.");
  }
  if (input.generatedImageCount !== 20) {
    throw new Error("Local vision runtime migration requires exactly 20 generated images.");
  }
  if (input.paidCompletedCount !== 20 || input.paidUnsafeCount !== 0) {
    throw new Error("Local vision runtime migration requires 20 completed paid slots and zero unsafe slots.");
  }
  if (input.publishManifestEntryCount !== 0) {
    throw new Error("Local vision runtime migration must not have publish entries.");
  }
}
