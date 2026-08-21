import path from "node:path";
import {
  archivePaidImageLedgerSnapshot
} from "../autolist/archive-main-images.js";
import {
  readPaidImageProductLedger,
  recordPaidImageRecoveredFromExistingResult,
  summarizePaidImageProductLedger,
  validatePaidImageExistingResultRecoveryPlan
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

function parseMappings(value: string): Array<{ targetSlot: number; sourceSlot: number }> {
  const mappings = value.split(",").map((item) => {
    const match = /^(\d+):(\d+)$/.exec(item.trim());
    if (!match) throw new Error(`Invalid slot mapping ${item}; expected target:source`);
    return { targetSlot: Number(match[1]), sourceSlot: Number(match[2]) };
  });
  if (!mappings.length || new Set(mappings.map((item) => item.targetSlot)).size !== mappings.length) {
    throw new Error("Slot recovery mappings require unique target slots");
  }
  return mappings;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const productDir = path.resolve(requireArg(args, "--product-dir"));
  const archiveRootDir = path.resolve(requireArg(args, "--archive-root"));
  const productName = requireArg(args, "--product-name");
  const reason = requireArg(args, "--reason");
  const mappings = parseMappings(requireArg(args, "--map"));
  const ledger = readPaidImageProductLedger(productDir);
  validatePaidImageExistingResultRecoveryPlan({ productDir, mappings });
  const before = archivePaidImageLedgerSnapshot({
    productDir,
    productName,
    archiveRootDir,
    label: "恢复前原始无水印图"
  });
  const recovered = mappings.map((mapping) =>
    recordPaidImageRecoveredFromExistingResult({ productDir, ...mapping, reason })
  );
  const summary = summarizePaidImageProductLedger(productDir);
  if (summary.completed !== ledger.expectedSlotCount) {
    throw new Error(
      `Operator-approved recovery did not complete the paid image ledger: ${summary.completed}/${ledger.expectedSlotCount}`
    );
  }
  const after = archivePaidImageLedgerSnapshot({
    productDir,
    productName,
    archiveRootDir,
    label: "恢复后完整无水印图"
  });
  console.log(JSON.stringify({
    ok: true,
    batchFingerprint: ledger.batchFingerprint,
    recordId: ledger.recordId,
    mappings,
    recoveredSlots: recovered.map((record) => record.slot),
    completed: summary.completed,
    expected: summary.expectedSlotCount,
    before,
    after
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
