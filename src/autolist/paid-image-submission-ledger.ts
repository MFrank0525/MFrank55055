import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type PaidImageSlotState = "reserved" | "submitted" | "completed" | "failed_before_acceptance" | "ambiguous";

export interface PaidImageSlotAuditEntry {
  state: PaidImageSlotState;
  at: string;
  owner?: PaidImageSlotOwner;
  reason?: string;
}

export interface PaidImageSlotOwner {
  runId?: string;
  taskId?: string;
  pid?: number;
}

export interface PaidImageSlotRecord {
  version: 1;
  slot: number;
  requestDigest: string;
  promptDigest: string;
  state: PaidImageSlotState;
  createdAt: string;
  updatedAt: string;
  owner?: PaidImageSlotOwner;
  providerTaskId?: string;
  providerResponseSummary?: Record<string, unknown>;
  resultFile?: string;
  resultDigest?: string;
  reason?: string;
  audit: PaidImageSlotAuditEntry[];
}

export interface PaidImageProductLedger {
  version: 1;
  batchFingerprint: string;
  recordId: string;
  expectedSlotCount: number;
  providerIdentity: string;
  sourceImageDigest: string;
  createdAt: string;
  productDir: string;
}

export interface PaidImageLedgerSummary {
  expectedSlotCount: number;
  missing: number;
  reserved: number;
  submitted: number;
  completed: number;
  failedBeforeAcceptance: number;
  ambiguous: number;
}

export type PaidImageSlotAction =
  | { action: "submit"; record: PaidImageSlotRecord }
  | { action: "poll"; record: PaidImageSlotRecord; providerTaskId: string }
  | { action: "reuse"; record: PaidImageSlotRecord; resultFile: string }
  | { action: "blocked_reserved" | "blocked_ambiguous"; record: PaidImageSlotRecord }
  | { action: "missing" | "retry_failed_before_acceptance"; record?: PaidImageSlotRecord };

export interface InitializePaidImageProductLedgerInput {
  rootDir: string;
  batchFingerprint: string;
  recordId: string;
  expectedSlotCount: number;
  providerIdentity: string;
  sourceImageDigest: string;
}

export interface ReservePaidImageSlotInput {
  productDir: string;
  slot: number;
  requestDigest: string;
  promptDigest: string;
  owner: PaidImageSlotOwner;
}

export interface ResolvePaidImageSlotActionInput {
  productDir: string;
  slot: number;
}

export interface RecordPaidImageSubmittedInput {
  productDir: string;
  slot: number;
  providerTaskId: string;
  providerResponse?: unknown;
}

export interface RecordPaidImageCompletedInput {
  productDir: string;
  slot: number;
  sourceFile: string;
}

export interface RecordPaidImageAmbiguousInput {
  productDir: string;
  slot: number;
  reason: string;
  providerResponse?: unknown;
}

export interface RecordPaidImageFailedBeforeAcceptanceInput {
  productDir: string;
  slot: number;
  reason: string;
}

const states = new Set<PaidImageSlotState>([
  "reserved",
  "submitted",
  "completed",
  "failed_before_acceptance",
  "ambiguous"
]);

export function sha256Text(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function requireNonEmpty(value: string, name: string): string {
  if (!value || !value.trim()) {
    throw new Error(`${name} must be non-empty`);
  }
  return value;
}

function sanitizePathSegment(value: string, name: string): string {
  const original = requireNonEmpty(value, name);
  const readable = original
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 80) || "identity";
  return `${readable}-${sha256Text(original).slice(0, 12)}`;
}

export function paidImageProductLedgerDir(rootDir: string, batchFingerprint: string, recordId: string): string {
  requireNonEmpty(rootDir, "rootDir");
  return path.join(
    path.resolve(rootDir),
    sanitizePathSegment(batchFingerprint, "batchFingerprint"),
    sanitizePathSegment(recordId, "recordId")
  );
}

function productFile(productDir: string): string {
  return path.join(productDir, "product.json");
}

function slotFile(productDir: string, slot: number): string {
  return path.join(productDir, "slots", `${String(slot).padStart(2, "0")}.json`);
}

function wait(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireExclusiveLock(lockFile: string): number {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      return fs.openSync(lockFile, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      wait(10);
    }
  }
  throw new Error(`timed out waiting for paid image ledger lock: ${lockFile}`);
}

function withSlotLock<T>(productDir: string, slot: number, action: () => T): T {
  const lockFile = `${slotFile(productDir, slot)}.lock`;
  const fd = acquireExclusiveLock(lockFile);
  try {
    return action();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lockFile);
  }
}

function waitForSlotLock(productDir: string, slot: number): void {
  const lockFile = `${slotFile(productDir, slot)}.lock`;
  for (let attempt = 0; attempt < 500 && fs.existsSync(lockFile); attempt += 1) {
    wait(10);
  }
  if (fs.existsSync(lockFile)) {
    throw new Error(`timed out waiting for paid image ledger lock: ${lockFile}`);
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`invalid ledger JSON at ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readSlotJson(file: string): unknown {
  let lastError: unknown;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      lastError = error;
      wait(10);
    }
  }
  throw new Error(`invalid ledger JSON at ${file}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function atomicWriteJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) {
      fs.unlinkSync(temp);
    }
  }
}

function validateProductLedger(value: unknown, expected?: InitializePaidImageProductLedgerInput): PaidImageProductLedger {
  if (!value || typeof value !== "object") {
    throw new Error("invalid paid image product ledger");
  }
  const ledger = value as PaidImageProductLedger;
  if (
    ledger.version !== 1 ||
    typeof ledger.batchFingerprint !== "string" ||
    typeof ledger.recordId !== "string" ||
    !Number.isInteger(ledger.expectedSlotCount) ||
    ledger.expectedSlotCount < 1 ||
    ledger.expectedSlotCount > 20 ||
    typeof ledger.providerIdentity !== "string" ||
    typeof ledger.sourceImageDigest !== "string" ||
    typeof ledger.createdAt !== "string"
  ) {
    throw new Error("invalid paid image product ledger");
  }
  if (
    expected &&
    (ledger.batchFingerprint !== expected.batchFingerprint ||
      ledger.recordId !== expected.recordId ||
      ledger.expectedSlotCount !== expected.expectedSlotCount ||
      ledger.providerIdentity !== expected.providerIdentity ||
      ledger.sourceImageDigest !== expected.sourceImageDigest)
  ) {
    throw new Error("paid image product ledger identity conflict");
  }
  return ledger;
}

function readProductLedger(productDir: string): PaidImageProductLedger {
  const ledger = validateProductLedger(readJson(productFile(productDir)));
  return { ...ledger, productDir };
}

function validateSlotRange(productDir: string, slot: number): PaidImageProductLedger {
  const ledger = readProductLedger(productDir);
  if (!Number.isInteger(slot) || slot < 1 || slot > ledger.expectedSlotCount) {
    throw new Error(`paid image slot ${slot} is outside expected range 1-${ledger.expectedSlotCount}`);
  }
  return ledger;
}

function isSafePersistedText(value: unknown): value is string {
  return typeof value === "string" && cleanText(value) === value;
}

function isValidOwner(value: unknown): value is PaidImageSlotOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const owner = value as PaidImageSlotOwner;
  return (
    Object.keys(value).every((key) => key === "runId" || key === "taskId" || key === "pid") &&
    (owner.runId === undefined || isSafePersistedText(owner.runId)) &&
    (owner.taskId === undefined || isSafePersistedText(owner.taskId)) &&
    (owner.pid === undefined || Number.isInteger(owner.pid))
  );
}

function validateAudit(value: unknown): value is PaidImageSlotAuditEntry[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        states.has((entry as PaidImageSlotAuditEntry).state) &&
        typeof (entry as PaidImageSlotAuditEntry).at === "string" &&
        ((entry as PaidImageSlotAuditEntry).reason === undefined ||
          isSafePersistedText((entry as PaidImageSlotAuditEntry).reason)) &&
        ((entry as PaidImageSlotAuditEntry).owner === undefined || isValidOwner((entry as PaidImageSlotAuditEntry).owner))
    )
  );
}

function isSafeProviderTaskId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function isPlainScalarRecord(value: unknown): value is Record<string, string | number | boolean | null> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(
      (item) =>
        (typeof item === "string" && cleanText(item) === item) ||
        typeof item === "number" ||
        typeof item === "boolean" ||
        item === null
    )
  );
}

function validateSlotRecord(value: unknown, expectedSlot: number): PaidImageSlotRecord {
  if (!value || typeof value !== "object") {
    throw new Error(`invalid paid image slot record for slot ${expectedSlot}`);
  }
  const record = value as PaidImageSlotRecord;
  if (
    record.version !== 1 ||
    record.slot !== expectedSlot ||
    typeof record.requestDigest !== "string" ||
    !record.requestDigest ||
    typeof record.promptDigest !== "string" ||
    !record.promptDigest ||
    !states.has(record.state) ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    !validateAudit(record.audit) ||
    record.audit.at(-1)?.state !== record.state ||
    (record.providerTaskId !== undefined && !isSafeProviderTaskId(record.providerTaskId)) ||
    (record.providerResponseSummary !== undefined && !isPlainScalarRecord(record.providerResponseSummary)) ||
    (record.resultFile !== undefined && (typeof record.resultFile !== "string" || !path.isAbsolute(record.resultFile))) ||
    (record.resultDigest !== undefined &&
      (typeof record.resultDigest !== "string" || !/^[a-f0-9]{64}$/.test(record.resultDigest))) ||
    (record.reason !== undefined && !isSafePersistedText(record.reason)) ||
    (record.owner !== undefined && !isValidOwner(record.owner))
  ) {
    throw new Error(`invalid paid image slot record for slot ${expectedSlot}`);
  }
  if (record.state === "submitted" && !record.providerTaskId) {
    throw new Error(`invalid paid image slot record for slot ${expectedSlot}: submitted task id missing`);
  }
  if (record.state === "completed" && (!record.resultFile || !record.resultDigest)) {
    throw new Error(`invalid paid image slot record for slot ${expectedSlot}: completed result missing`);
  }
  return record;
}

function readSlotRecordUnlocked(productDir: string, slot: number): PaidImageSlotRecord | undefined {
  validateSlotRange(productDir, slot);
  const file = slotFile(productDir, slot);
  return fs.existsSync(file) ? validateSlotRecord(readSlotJson(file), slot) : undefined;
}

function readSlotRecord(productDir: string, slot: number): PaidImageSlotRecord | undefined {
  validateSlotRange(productDir, slot);
  waitForSlotLock(productDir, slot);
  return readSlotRecordUnlocked(productDir, slot);
}

function assertSlotIdentity(record: PaidImageSlotRecord, requestDigest: string, promptDigest: string): void {
  if (record.requestDigest !== requestDigest || record.promptDigest !== promptDigest) {
    throw new Error(`paid image slot identity conflict for slot ${record.slot}`);
  }
}

function cleanText(value: string): string {
  if (
    value.length > 500 ||
    /data:[^;,]+;base64,|bearer\s|authorization|api[_-]?key|access[_-]?token|secret/i.test(value) ||
    (value.length >= 128 && /^[A-Za-z0-9+/_=-]+$/.test(value))
  ) {
    return "[redacted]";
  }
  return value;
}

function providerResponseSummary(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const allowed = new Set(["id", "task_id", "taskId", "status", "state", "code", "message", "error"]);
  const summary: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(key)) {
      continue;
    }
    if (typeof item === "string") {
      summary[key] = cleanText(item);
    } else if (typeof item === "number" || typeof item === "boolean" || item === null) {
      summary[key] = item;
    }
  }
  return Object.keys(summary).length ? summary : undefined;
}

export function initializePaidImageProductLedger(input: InitializePaidImageProductLedgerInput): PaidImageProductLedger {
  requireNonEmpty(input.providerIdentity, "providerIdentity");
  requireNonEmpty(input.sourceImageDigest, "sourceImageDigest");
  if (!Number.isInteger(input.expectedSlotCount) || input.expectedSlotCount < 1 || input.expectedSlotCount > 20) {
    throw new Error("expectedSlotCount must be an integer between 1 and 20");
  }
  const productDir = paidImageProductLedgerDir(input.rootDir, input.batchFingerprint, input.recordId);
  fs.mkdirSync(path.join(productDir, "slots"), { recursive: true });
  fs.mkdirSync(path.join(productDir, "results"), { recursive: true });
  const created: PaidImageProductLedger = {
    version: 1,
    batchFingerprint: input.batchFingerprint,
    recordId: input.recordId,
    expectedSlotCount: input.expectedSlotCount,
    providerIdentity: input.providerIdentity,
    sourceImageDigest: input.sourceImageDigest,
    createdAt: new Date().toISOString(),
    productDir
  };
  const file = productFile(productDir);
  const lockFile = `${file}.lock`;
  const lockFd = acquireExclusiveLock(lockFile);
  try {
    if (!fs.existsSync(file)) {
      atomicWriteJson(file, created);
    }
    const existing = validateProductLedger(readJson(file), input);
    return { ...existing, productDir };
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lockFile);
  }
}

function actionForRecord(record: PaidImageSlotRecord): PaidImageSlotAction {
  switch (record.state) {
    case "reserved":
      return { action: "blocked_reserved", record };
    case "submitted":
      return { action: "poll", record, providerTaskId: record.providerTaskId! };
    case "completed":
      if (!fs.existsSync(record.resultFile!) || sha256File(record.resultFile!) !== record.resultDigest) {
        throw new Error(`completed paid image result is missing or invalid for slot ${record.slot}`);
      }
      return { action: "reuse", record, resultFile: record.resultFile! };
    case "ambiguous":
      return { action: "blocked_ambiguous", record };
    case "failed_before_acceptance":
      return { action: "retry_failed_before_acceptance", record };
  }
}

function createReservedRecord(input: ReservePaidImageSlotInput, audit: PaidImageSlotAuditEntry[] = []): PaidImageSlotRecord {
  const at = new Date().toISOString();
  const cleanOwner = {
    ...(input.owner.runId ? { runId: cleanText(input.owner.runId) } : {}),
    ...(input.owner.taskId ? { taskId: cleanText(input.owner.taskId) } : {}),
    ...(Number.isInteger(input.owner.pid) ? { pid: input.owner.pid } : {})
  };
  return {
    version: 1,
    slot: input.slot,
    requestDigest: requireNonEmpty(input.requestDigest, "requestDigest"),
    promptDigest: requireNonEmpty(input.promptDigest, "promptDigest"),
    state: "reserved",
    createdAt: audit[0]?.at || at,
    updatedAt: at,
    owner: cleanOwner,
    audit: [...audit, { state: "reserved", at, owner: cleanOwner }]
  };
}

export function reservePaidImageSlot(input: ReservePaidImageSlotInput): PaidImageSlotAction {
  validateSlotRange(input.productDir, input.slot);
  const file = slotFile(input.productDir, input.slot);
  const reserved = createReservedRecord(input);
  let reservationFd: number | undefined;
  try {
    reservationFd = fs.openSync(file, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
  if (reservationFd !== undefined) {
    try {
      fs.writeFileSync(reservationFd, JSON.stringify(reserved, null, 2) + "\n", "utf8");
      fs.fsyncSync(reservationFd);
    } finally {
      fs.closeSync(reservationFd);
    }
    return { action: "submit", record: reserved };
  }

  return withSlotLock(input.productDir, input.slot, () => {
    const existing = readSlotRecordUnlocked(input.productDir, input.slot);
    if (!existing) {
      throw new Error(`paid image slot ${input.slot} disappeared after reservation conflict`);
    }
    assertSlotIdentity(existing, input.requestDigest, input.promptDigest);
    if (existing.state !== "failed_before_acceptance") {
      return actionForRecord(existing);
    }
    const reacquired = createReservedRecord(input, existing.audit);
    atomicWriteJson(slotFile(input.productDir, input.slot), reacquired);
    return { action: "submit", record: reacquired };
  });
}

export function resolvePaidImageSlotAction(input: ResolvePaidImageSlotActionInput): PaidImageSlotAction {
  const record = readSlotRecord(input.productDir, input.slot);
  return record ? actionForRecord(record) : { action: "missing" };
}

function transitionSlot(
  productDir: string,
  slot: number,
  allowedStates: PaidImageSlotState[],
  nextState: PaidImageSlotState,
  changes: Partial<PaidImageSlotRecord>
): PaidImageSlotRecord {
  validateSlotRange(productDir, slot);
  return withSlotLock(productDir, slot, () => transitionSlotUnlocked(productDir, slot, allowedStates, nextState, changes));
}

function transitionSlotUnlocked(
  productDir: string,
  slot: number,
  allowedStates: PaidImageSlotState[],
  nextState: PaidImageSlotState,
  changes: Partial<PaidImageSlotRecord>
): PaidImageSlotRecord {
  const record = readSlotRecordUnlocked(productDir, slot);
  if (!record || !allowedStates.includes(record.state)) {
    throw new Error(`invalid slot transition for slot ${slot}: ${record?.state || "missing"} -> ${nextState}`);
  }
  const at = new Date().toISOString();
  const next: PaidImageSlotRecord = {
    ...record,
    ...changes,
    state: nextState,
    updatedAt: at,
    audit: [...record.audit, { state: nextState, at, ...(changes.reason ? { reason: cleanText(changes.reason) } : {}) }]
  };
  atomicWriteJson(slotFile(productDir, slot), next);
  return validateSlotRecord(next, slot);
}

export function recordPaidImageSubmitted(input: RecordPaidImageSubmittedInput): PaidImageSlotRecord {
  if (!isSafeProviderTaskId(input.providerTaskId)) {
    throw new Error("providerTaskId must be a bounded safe scalar");
  }
  return transitionSlot(input.productDir, input.slot, ["reserved"], "submitted", {
    providerTaskId: input.providerTaskId,
    providerResponseSummary: providerResponseSummary(input.providerResponse)
  });
}

export function recordPaidImageCompleted(input: RecordPaidImageCompletedInput): PaidImageSlotRecord {
  if (!fs.statSync(input.sourceFile).isFile()) {
    throw new Error(`completed paid image source is not a file: ${input.sourceFile}`);
  }
  validateSlotRange(input.productDir, input.slot);
  return withSlotLock(input.productDir, input.slot, () => {
    const record = readSlotRecordUnlocked(input.productDir, input.slot);
    if (!record || record.state !== "submitted") {
      throw new Error(`invalid slot transition for slot ${input.slot}: ${record?.state || "missing"} -> completed`);
    }
    const resultFile = path.join(input.productDir, "results", `${String(input.slot).padStart(2, "0")}.png`);
    const tempResult = `${resultFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.copyFileSync(input.sourceFile, tempResult, fs.constants.COPYFILE_EXCL);
      fs.renameSync(tempResult, resultFile);
    } finally {
      if (fs.existsSync(tempResult)) {
        fs.unlinkSync(tempResult);
      }
    }
    return transitionSlotUnlocked(input.productDir, input.slot, ["submitted"], "completed", {
      resultFile,
      resultDigest: sha256File(resultFile)
    });
  });
}

export function recordPaidImageAmbiguous(input: RecordPaidImageAmbiguousInput): PaidImageSlotRecord {
  return transitionSlot(input.productDir, input.slot, ["reserved", "submitted"], "ambiguous", {
    reason: cleanText(requireNonEmpty(input.reason, "reason")),
    providerResponseSummary: providerResponseSummary(input.providerResponse)
  });
}

export function recordPaidImageFailedBeforeAcceptance(input: RecordPaidImageFailedBeforeAcceptanceInput): PaidImageSlotRecord {
  return transitionSlot(input.productDir, input.slot, ["reserved"], "failed_before_acceptance", {
    reason: cleanText(requireNonEmpty(input.reason, "reason"))
  });
}

export function summarizePaidImageProductLedger(productDir: string): PaidImageLedgerSummary {
  const product = readProductLedger(productDir);
  const summary: PaidImageLedgerSummary = {
    expectedSlotCount: product.expectedSlotCount,
    missing: product.expectedSlotCount,
    reserved: 0,
    submitted: 0,
    completed: 0,
    failedBeforeAcceptance: 0,
    ambiguous: 0
  };
  for (const file of fs.readdirSync(path.join(productDir, "slots"))) {
    const match = /^(\d+)\.json$/.exec(file);
    if (!match) {
      if (!file.endsWith(".lock")) {
        throw new Error(`invalid paid image slot ledger file: ${file}`);
      }
      continue;
    }
    const slot = Number(match[1]);
    if (slot < 1 || slot > product.expectedSlotCount) {
      throw new Error(`paid image slot ${slot} is outside expected range 1-${product.expectedSlotCount}`);
    }
    const record = readSlotRecord(productDir, slot);
    if (!record) {
      throw new Error(`paid image slot ${slot} disappeared while summarizing ledger`);
    }
    summary.missing -= 1;
    if (record.state === "failed_before_acceptance") {
      summary.failedBeforeAcceptance += 1;
    } else {
      summary[record.state] += 1;
    }
  }
  return summary;
}
