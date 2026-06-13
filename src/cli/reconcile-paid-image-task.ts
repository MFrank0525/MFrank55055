import fs from "node:fs";
import path from "node:path";
import {
  readPaidImageSlotRecord,
  reconcileAmbiguousPaidImageNoAcceptance,
  reconcileAmbiguousPaidImageProviderFailure,
  reconcileAmbiguousPaidImageTask
} from "../autolist/paid-image-submission-ledger.js";
import { validatePaidImageProviderTaskForReconciliation } from "../autolist/paid-image-reconciliation.js";

interface ImageProviderConfig {
  apiUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key?.startsWith("--") && (!value || value.startsWith("--"))) {
      args.set(key, "true");
      continue;
    }
    if (key?.startsWith("--") && value && !value.startsWith("--")) {
      args.set(key, value);
      index += 1;
    }
  }
  return args;
}

function requireArg(args: Map<string, string>, name: string): string {
  const value = args.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing required argument ${name}`);
  }
  return value;
}

function providerTaskUrl(apiUrl: string, taskId: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/${encodeURIComponent(taskId)}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const productDir = path.resolve(requireArg(args, "--product-dir"));
  const slot = Number(requireArg(args, "--slot"));
  const reason = requireArg(args, "--reason");
  if (args.has("--provider-failure")) {
    const taskId = requireArg(args, "--task-id");
    const record = reconcileAmbiguousPaidImageProviderFailure({
      productDir,
      slot,
      providerTaskId: taskId,
      reason
    });
    console.log(JSON.stringify({ ok: true, productDir, slot, taskId, providerFailure: true, ledgerState: record.state }, null, 2));
    return;
  }
  if (args.has("--no-provider-task")) {
    if (args.has("--task-id")) {
      throw new Error("--task-id cannot be used with --no-provider-task");
    }
    const record = reconcileAmbiguousPaidImageNoAcceptance({
      productDir,
      slot,
      reason
    });
    console.log(JSON.stringify({ ok: true, productDir, slot, noProviderTask: true, ledgerState: record.state }, null, 2));
    return;
  }

  const taskId = requireArg(args, "--task-id");
  const configFile = path.resolve(args.get("--config") || "input/image-generation.config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8")) as ImageProviderConfig;
  if (!config.apiUrl || !config.apiKey) {
    throw new Error(`Image provider config is missing apiUrl or apiKey: ${configFile}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(30000, config.timeoutMs || 180000));
  let response: Response;
  try {
    response = await fetch(providerTaskUrl(config.apiUrl, taskId), {
      headers: { Authorization: "Bearer " + config.apiKey },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Provider task verification failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  const payload = JSON.parse(text) as unknown;
  const slotRecord = readPaidImageSlotRecord({ productDir, slot });
  if (!slotRecord || slotRecord.state !== "ambiguous") {
    throw new Error(`Paid image slot ${slot} is not ambiguous and cannot be reconciled`);
  }
  const verified = validatePaidImageProviderTaskForReconciliation({
    requestedTaskId: taskId,
    slotCreatedAt: slotRecord.createdAt,
    payload
  });
  const record = reconcileAmbiguousPaidImageTask({
    productDir,
    slot,
    providerTaskId: verified.taskId,
    reason,
    providerResponse: payload
  });
  console.log(JSON.stringify({ ok: true, productDir, slot, taskId: verified.taskId, status: verified.status, ledgerState: record.state }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
