import fs from "node:fs";
import path from "node:path";
import {
  approvePaidImageRechargeRetry,
  readPaidImageProductLedger,
  readPaidImageSlotRecord
} from "../autolist/paid-image-submission-ledger.js";

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key?.startsWith("--") && value && !value.startsWith("--")) {
      args.set(key, value);
      index += 1;
    }
  }
  return args;
}

function requireArg(args: Map<string, string>, name: string): string {
  const value = args.get(name)?.trim();
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function parseSlots(value: string): number[] {
  const slots = value.split(",").map((item) => Number(item.trim()));
  if (!slots.length || slots.some((slot) => !Number.isInteger(slot)) || new Set(slots).size !== slots.length) {
    throw new Error("--slots requires unique comma-separated integers");
  }
  return slots;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const productDir = path.resolve(requireArg(args, "--product-dir"));
  const slots = parseSlots(requireArg(args, "--slots"));
  const reason = requireArg(args, "--reason");
  const controllerFile = path.resolve(args.get("--controller-job") || "data/auto-listing/control/auto-listing-controller-job.json");
  const controller = JSON.parse(fs.readFileSync(controllerFile, "utf8")) as { status?: string; pid?: number };
  if (controller.status === "running" || (Number.isInteger(controller.pid) && processAlive(controller.pid!))) {
    throw new Error("Cannot approve paid image recharge retry while the auto-listing controller is alive");
  }
  const ledger = readPaidImageProductLedger(productDir);
  const records = slots.map((slot) => readPaidImageSlotRecord({ productDir, slot }));
  for (const [index, record] of records.entries()) {
    const originalReason = record?.reason || "";
    if (
      !record
      || record.state !== "failed_before_acceptance"
      || record.replayDisposition !== "non_replayable"
      || record.providerTaskId
      || record.providerResponseSummary
      || !/HTTP\s*403/i.test(originalReason)
      || !/insufficient_user_quota|用户额度不足/i.test(originalReason)
    ) {
      throw new Error(`paid image slot ${slots[index]} is not recharge-recoverable`);
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = path.resolve("data/auto-listing/recovery-archives", `paid-image-recharge-${stamp}`);
  fs.mkdirSync(archiveDir, { recursive: false });
  fs.copyFileSync(path.join(productDir, "product.json"), path.join(archiveDir, "product.json"));
  for (const slot of slots) {
    const name = `${String(slot).padStart(2, "0")}.json`;
    fs.copyFileSync(path.join(productDir, "slots", name), path.join(archiveDir, name));
  }
  fs.writeFileSync(path.join(archiveDir, "approval.json"), JSON.stringify({
    approvedAt: new Date().toISOString(),
    batchFingerprint: ledger.batchFingerprint,
    recordId: ledger.recordId,
    slots,
    reason
  }, null, 2) + "\n");
  const approved = slots.map((slot) => approvePaidImageRechargeRetry({ productDir, slot, reason }));
  console.log(JSON.stringify({
    ok: true,
    batchFingerprint: ledger.batchFingerprint,
    recordId: ledger.recordId,
    slots: approved.map((record) => record.slot),
    archiveDir
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
