import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson } from "../utils/atomic-file.js";
import type { ConfirmedRejectionRetryIdentity } from "./confirmed-rejection-retry.js";

const FILE_NAME = "category-validation-retry.json";
export const CATEGORY_VALIDATION_RETRY_REVISION = "opened-category-advice-title-fallback-v11";

function normalize(identity: ConfirmedRejectionRetryIdentity): ConfirmedRejectionRetryIdentity {
  return {
    targetKey: identity.targetKey.trim(),
    title: identity.title.trim(),
    shopFolder: path.resolve(identity.shopFolder)
  };
}

export function isCategoryValidationRetryConsumed(
  runtimeDir: string,
  identity: ConfirmedRejectionRetryIdentity
): boolean {
  const file = path.join(runtimeDir, FILE_NAME);
  if (!fs.existsSync(file)) return false;
  const ledger = JSON.parse(fs.readFileSync(file, "utf8")) as ConfirmedRejectionRetryIdentity & {
    state?: string;
    consumedAt?: string;
    recoveryRevision?: string;
  };
  const expected = normalize(identity);
  if (
    ledger.state !== "consumed"
    || !ledger.consumedAt
    || ledger.targetKey !== expected.targetKey
    || ledger.title !== expected.title
    || path.resolve(ledger.shopFolder || "") !== expected.shopFolder
  ) {
    throw new Error(`Category-validation retry ledger is invalid or identity-mismatched: ${file}`);
  }
  return ledger.recoveryRevision === CATEGORY_VALIDATION_RETRY_REVISION;
}

export function consumeCategoryValidationRetry(
  runtimeDir: string,
  identity: ConfirmedRejectionRetryIdentity
): string {
  if (isCategoryValidationRetryConsumed(runtimeDir, identity)) {
    return path.join(runtimeDir, FILE_NAME);
  }
  const normalized = normalize(identity);
  if (!normalized.targetKey || !normalized.title || !normalized.shopFolder) {
    throw new Error("Category-validation retry identity is incomplete.");
  }
  const file = path.join(runtimeDir, FILE_NAME);
  atomicWriteJson(file, {
    state: "consumed",
    ...normalized,
    recoveryRevision: CATEGORY_VALIDATION_RETRY_REVISION,
    consumedAt: new Date().toISOString()
  });
  return file;
}
