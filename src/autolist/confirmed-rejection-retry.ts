import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson } from "../utils/atomic-file.js";

export interface ConfirmedRejectionRetryIdentity {
  targetKey: string;
  title: string;
  shopFolder: string;
}

interface ConfirmedRejectionRetryLedger extends ConfirmedRejectionRetryIdentity {
  state: "consumed";
  consumedAt: string;
}

const FILE_NAME = "confirmed-rejection-retry.json";

function normalize(input: ConfirmedRejectionRetryIdentity): ConfirmedRejectionRetryIdentity {
  return {
    targetKey: input.targetKey.trim(),
    title: input.title.trim(),
    shopFolder: path.resolve(input.shopFolder)
  };
}

function readLedger(runtimeDir: string): ConfirmedRejectionRetryLedger | undefined {
  const file = path.join(runtimeDir, FILE_NAME);
  if (!fs.existsSync(file)) return undefined;
  const ledger = JSON.parse(fs.readFileSync(file, "utf8")) as ConfirmedRejectionRetryLedger;
  if (ledger.state !== "consumed" || !ledger.targetKey || !ledger.title || !ledger.shopFolder || !ledger.consumedAt) {
    throw new Error(`Invalid confirmed rejection retry ledger: ${file}`);
  }
  return { ...ledger, ...normalize(ledger) };
}

function assertIdentity(
  ledger: ConfirmedRejectionRetryLedger,
  expected: ConfirmedRejectionRetryIdentity
): void {
  const normalized = normalize(expected);
  if (
    ledger.targetKey !== normalized.targetKey
    || ledger.title !== normalized.title
    || ledger.shopFolder !== normalized.shopFolder
  ) {
    throw new Error(`Confirmed rejection retry ledger identity mismatch for ${normalized.targetKey}.`);
  }
}

export function isConfirmedRejectionRetryConsumed(
  runtimeDir: string,
  identity: ConfirmedRejectionRetryIdentity
): boolean {
  const ledger = readLedger(runtimeDir);
  if (!ledger) return false;
  assertIdentity(ledger, identity);
  return true;
}

export function consumeConfirmedRejectionRetry(
  runtimeDir: string,
  identity: ConfirmedRejectionRetryIdentity
): string {
  const existing = readLedger(runtimeDir);
  if (existing) {
    assertIdentity(existing, identity);
    return path.join(runtimeDir, FILE_NAME);
  }
  const normalized = normalize(identity);
  if (!normalized.targetKey || !normalized.title || !normalized.shopFolder) {
    throw new Error("Confirmed rejection retry identity is incomplete.");
  }
  const file = path.join(runtimeDir, FILE_NAME);
  atomicWriteJson(file, {
    state: "consumed",
    ...normalized,
    consumedAt: new Date().toISOString()
  });
  return file;
}
