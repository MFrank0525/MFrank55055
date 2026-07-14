import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { submitTransportFailureProvesNoPaidTaskAccepted } from "./image-generation-rules.js";

export type PaidImageSlotState =
  | "reserved"
  | "submitted"
  | "completed"
  | "failed_before_acceptance"
  | "failed_after_acceptance"
  | "ambiguous";

export type PaidImageReplayDisposition = "non_replayable";

export interface PaidImageSlotAuditEntry {
  state: PaidImageSlotState;
  at: string;
  owner?: PaidImageSlotOwner;
  reason?: string;
  replayDisposition?: PaidImageReplayDisposition;
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
  replayDisposition?: PaidImageReplayDisposition;
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
  failedAfterAcceptance: number;
  ambiguous: number;
}

export interface PaidImageLedgerArtifactIntegrityIssue {
  code: "completed_result_missing_or_invalid";
  slot: number;
  message: string;
}

export interface PaidImageLedgerAuditInspection {
  summary: PaidImageLedgerSummary;
  errors: PaidImageLedgerArtifactIntegrityIssue[];
}

export interface PaidImageLedgerExpectedIdentity {
  batchFingerprint: string;
  recordId: string;
}

export type PaidImageSlotAction =
  | { action: "submit"; record: PaidImageSlotRecord }
  | { action: "poll"; record: PaidImageSlotRecord; providerTaskId: string }
  | { action: "reuse"; record: PaidImageSlotRecord; resultFile: string }
  | { action: "blocked_reserved" | "blocked_ambiguous"; record: PaidImageSlotRecord }
  | { action: "missing" | "retry_failed_before_acceptance" | "retry_failed_after_acceptance"; record?: PaidImageSlotRecord };

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
  allowFailedAfterAcceptanceDigestChange?: boolean;
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

export interface ReconcileAmbiguousPaidImageTaskInput {
  productDir: string;
  slot: number;
  providerTaskId: string;
  reason: string;
  providerResponse?: unknown;
}

export interface ReconcileAmbiguousPaidImageNoAcceptanceInput {
  productDir: string;
  slot: number;
  reason: string;
}

export interface ReconcileAmbiguousPaidImageProviderFailureInput {
  productDir: string;
  slot: number;
  providerTaskId: string;
  reason: string;
}

export interface RecordPaidImageCompletedInput {
  productDir: string;
  slot: number;
  sourceFile: string;
  providerTaskId?: string;
}

export interface RecordPaidImageAmbiguousInput {
  productDir: string;
  slot: number;
  reason: string;
  providerResponse?: unknown;
  replayDisposition?: PaidImageReplayDisposition;
}

export interface RecordPaidImageFailedBeforeAcceptanceInput {
  productDir: string;
  slot: number;
  reason: string;
  replayDisposition?: PaidImageReplayDisposition;
}

export interface RecordPaidImageFailedAfterAcceptanceInput {
  productDir: string;
  slot: number;
  providerTaskId?: string;
  reason: string;
  providerResponse?: unknown;
  replayDisposition?: PaidImageReplayDisposition;
}

export interface ExpireSubmittedPaidImageQueueInput {
  productDir: string;
  slot: number;
  minSubmittedAgeMs: number;
  reason: string;
}

const states = new Set<PaidImageSlotState>([
  "reserved",
  "submitted",
  "completed",
  "failed_before_acceptance",
  "failed_after_acceptance",
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
    paidImageBatchLedgerDir(rootDir, batchFingerprint),
    sanitizePathSegment(recordId, "recordId")
  );
}

export function paidImageBatchLedgerDir(rootDir: string, batchFingerprint: string): string {
  requireNonEmpty(rootDir, "rootDir");
  return path.join(path.resolve(rootDir), sanitizePathSegment(batchFingerprint, "batchFingerprint"));
}

export function removePaidImageProductLedger(rootDir: string, batchFingerprint: string, recordId: string): boolean {
  const productDir = paidImageProductLedgerDir(rootDir, batchFingerprint, recordId);
  if (!fs.existsSync(productDir)) {
    return false;
  }
  fs.rmSync(productDir, { recursive: true, force: true });
  const batchDir = paidImageBatchLedgerDir(rootDir, batchFingerprint);
  if (fs.existsSync(batchDir) && fs.readdirSync(batchDir).length === 0) {
    fs.rmSync(batchDir, { recursive: true, force: true });
  }
  return true;
}

export function removePaidImageBatchLedger(rootDir: string, batchFingerprint: string): boolean {
  const batchDir = paidImageBatchLedgerDir(rootDir, batchFingerprint);
  if (!fs.existsSync(batchDir)) {
    return false;
  }
  fs.rmSync(batchDir, { recursive: true, force: true });
  return true;
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

interface LedgerLockMetadata {
  pid: number;
  acquiredAt: string;
  token: string;
  processIdentity?: string;
  processIdentitySource?: ProcessIdentitySource;
}

type ProcessIdentitySource = "ps-lstart-command-sha256" | "local-process-start-sha256" | "local-fallback";

interface ProcessIdentity {
  identity: string;
  source: ProcessIdentitySource;
}

const staleLockTimeoutMs = 60_000;
const currentProcessFallbackIdentity = sha256Text(
  `${process.pid}|${Math.round(Date.now() - process.uptime() * 1000)}|${process.execPath}`
);

function queryProcessIdentity(pid: number): ProcessIdentity | undefined {
  if (pid === process.pid) {
    return currentPaidImageLedgerProcessIdentity();
  }
  try {
    const output = execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart=,command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1_000
    }).trim();
    return output ? { identity: sha256Text(output), source: "ps-lstart-command-sha256" } : undefined;
  } catch {
    return undefined;
  }
}

export function currentPaidImageLedgerProcessIdentity(): ProcessIdentity {
  try {
    const output = execFileSync("/bin/ps", ["-p", String(process.pid), "-o", "lstart=,command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1_000
    }).trim();
    return output
      ? { identity: sha256Text(output), source: "ps-lstart-command-sha256" }
      : { identity: currentProcessFallbackIdentity, source: "local-process-start-sha256" };
  } catch {
    return { identity: currentProcessFallbackIdentity, source: "local-process-start-sha256" };
  }
}

function readLockMetadata(lockFile: string): LedgerLockMetadata | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(lockFile, "utf8")) as Partial<LedgerLockMetadata>;
    if (
      Number.isInteger(value.pid) &&
      typeof value.acquiredAt === "string" &&
      Number.isFinite(Date.parse(value.acquiredAt)) &&
      typeof value.token === "string" &&
      /^[a-f0-9-]{16,}$/.test(value.token) &&
      (value.processIdentity === undefined ||
        (typeof value.processIdentity === "string" && value.processIdentity.length > 0 && value.processIdentity.length <= 128)) &&
      (value.processIdentitySource === undefined ||
        value.processIdentitySource === "ps-lstart-command-sha256" ||
        value.processIdentitySource === "local-process-start-sha256" ||
        value.processIdentitySource === "local-fallback")
    ) {
      return value as LedgerLockMetadata;
    }
  } catch {
    // A lock without complete valid metadata cannot be proven stale.
  }
  return undefined;
}

function processLiveness(pid: number): "alive" | "dead" | "unknown" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return "dead";
    }
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      return "alive";
    }
    return "unknown";
  }
}

function isProvablyStaleLock(metadata: LedgerLockMetadata): boolean {
  const ageMs = Date.now() - Date.parse(metadata.acquiredAt);
  const liveness = processLiveness(metadata.pid);
  if (liveness === "dead") {
    return true;
  }
  const currentIdentity = queryProcessIdentity(metadata.pid);
  if (
    metadata.processIdentity &&
    metadata.processIdentitySource !== "local-fallback" &&
    currentIdentity &&
    currentIdentity.source === metadata.processIdentitySource
  ) {
    return metadata.processIdentity !== currentIdentity.identity;
  }
  if (liveness === "alive") {
    return false;
  }
  return ageMs >= staleLockTimeoutMs;
}

function tryCreateMetadataLock(lockFile: string): LedgerLockMetadata | undefined {
  const processIdentity = currentPaidImageLedgerProcessIdentity();
  const metadata: LedgerLockMetadata = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    token: crypto.randomUUID(),
    processIdentity: processIdentity.identity,
    processIdentitySource: processIdentity.source
  };
  const candidate = `${lockFile}.${metadata.token}.candidate.lock`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(candidate, "wx");
    fs.writeFileSync(fd, JSON.stringify(metadata) + "\n", "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    try {
      fs.linkSync(candidate, lockFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return undefined;
      }
      throw error;
    }
    fsyncDirectory(path.dirname(lockFile));
    return metadata;
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
    if (fs.existsSync(candidate)) {
      fs.unlinkSync(candidate);
    }
  }
}

function removeProvablyStaleLock(lockFile: string): boolean {
  const metadata = readLockMetadata(lockFile);
  if (metadata && isProvablyStaleLock(metadata) && readLockMetadata(lockFile)?.token === metadata.token) {
    fs.unlinkSync(lockFile);
    fsyncDirectory(path.dirname(lockFile));
    return true;
  }
  return false;
}

function recoverProvablyStaleLock(lockFile: string): boolean {
  const recoveryLock = `${lockFile}.recovery.lock`;
  const recoveryMetadata = tryCreateMetadataLock(recoveryLock);
  if (!recoveryMetadata) {
    removeProvablyStaleLock(recoveryLock);
    return false;
  }
  try {
    return removeProvablyStaleLock(lockFile);
  } finally {
    releaseExclusiveLock(recoveryLock, recoveryMetadata);
  }
}

function acquireExclusiveLock(lockFile: string): LedgerLockMetadata {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (fs.existsSync(`${lockFile}.recovery.lock`)) {
      removeProvablyStaleLock(`${lockFile}.recovery.lock`);
      wait(10);
      continue;
    }
    const metadata = tryCreateMetadataLock(lockFile);
    if (metadata) {
      return metadata;
    }
    recoverProvablyStaleLock(lockFile);
    wait(10);
  }
  throw new Error(`timed out waiting for paid image ledger lock: ${lockFile}`);
}

function releaseExclusiveLock(lockFile: string, metadata: LedgerLockMetadata): void {
  if (readLockMetadata(lockFile)?.token !== metadata.token) {
    throw new Error(`paid image ledger lock ownership changed before release: ${lockFile}`);
  }
  fs.unlinkSync(lockFile);
  fsyncDirectory(path.dirname(lockFile));
}

function withSlotLock<T>(productDir: string, slot: number, action: () => T): T {
  const lockFile = `${slotFile(productDir, slot)}.lock`;
  const metadata = acquireExclusiveLock(lockFile);
  try {
    return action();
  } finally {
    releaseExclusiveLock(lockFile, metadata);
  }
}

function waitForSlotLock(productDir: string, slot: number): void {
  const lockFile = `${slotFile(productDir, slot)}.lock`;
  for (let attempt = 0; attempt < 500 && fs.existsSync(lockFile); attempt += 1) {
    recoverProvablyStaleLock(lockFile);
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
  let fd: number | undefined;
  try {
    fd = fs.openSync(temp, "wx");
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
    fsyncDirectory(path.dirname(file));
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
    if (fs.existsSync(temp)) {
      fs.unlinkSync(temp);
    }
  }
}

function fsyncDirectory(directory: string): void {
  const fd = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
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

function readProductLedger(
  productDir: string,
  expectedIdentity?: PaidImageLedgerExpectedIdentity
): PaidImageProductLedger {
  const ledger = validateProductLedger(readJson(productFile(productDir)));
  if (
    expectedIdentity &&
    (ledger.batchFingerprint !== expectedIdentity.batchFingerprint || ledger.recordId !== expectedIdentity.recordId)
  ) {
    throw new Error("paid image product ledger identity conflict");
  }
  return { ...ledger, productDir };
}

function productLedgerHasAcceptedOrActivePaidSlots(productDir: string, expectedSlotCount: number): boolean {
  for (let slot = 1; slot <= expectedSlotCount; slot += 1) {
    const file = slotFile(productDir, slot);
    if (!fs.existsSync(file)) {
      continue;
    }
    const record = validateSlotRecord(readSlotJson(file), slot);
    if (record.state !== "failed_before_acceptance") {
      return true;
    }
  }
  return false;
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
        ((entry as PaidImageSlotAuditEntry).replayDisposition === undefined ||
          (entry as PaidImageSlotAuditEntry).replayDisposition === "non_replayable") &&
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
    (record.replayDisposition !== undefined && record.replayDisposition !== "non_replayable") ||
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
  const redacted = value
    .replace(
      /(authorization|bearer|api(?:[-_\s]?key)|secret|token|cookie|sig|signature)(["'\s:=]+)([^&"'\s,}]+)/gi,
      "$1$2[redacted]"
    )
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted api key]")
    .replace(/https?:\/\/[^\s"',}]+/gi, "[redacted url]");
  if (
    redacted.length > 500 ||
    /data:[^;,]+;base64,|bearer\s|authorization|api(?:[_-\s]?key)|access[_-]?token|secret/i.test(redacted) ||
    (redacted.length >= 128 && /^[A-Za-z0-9+/_=-]+$/.test(redacted))
  ) {
    return "[redacted]";
  }
  return redacted;
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
  const lockMetadata = acquireExclusiveLock(lockFile);
  try {
    if (!fs.existsSync(file)) {
      atomicWriteJson(file, created);
    }
    let existing = validateProductLedger(readJson(file));
    const onlyProviderChanged =
      existing.batchFingerprint === input.batchFingerprint &&
      existing.recordId === input.recordId &&
      existing.expectedSlotCount === input.expectedSlotCount &&
      existing.sourceImageDigest === input.sourceImageDigest &&
      existing.providerIdentity !== input.providerIdentity;
    if (onlyProviderChanged && !productLedgerHasAcceptedOrActivePaidSlots(productDir, existing.expectedSlotCount)) {
      existing = { ...existing, providerIdentity: input.providerIdentity };
      atomicWriteJson(file, existing);
    }
    existing = validateProductLedger(readJson(file), input);
    return { ...existing, productDir };
  } finally {
    releaseExclusiveLock(lockFile, lockMetadata);
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
      if (isAutoRetryableNoAcceptanceAmbiguousRecord(record)) {
        return { action: "retry_failed_before_acceptance", record };
      }
      return { action: "blocked_ambiguous", record };
    case "failed_before_acceptance":
      return { action: "retry_failed_before_acceptance", record };
    case "failed_after_acceptance":
      return { action: "retry_failed_after_acceptance", record };
  }
}

function isAutoRetryableNoAcceptanceAmbiguousRecord(record: PaidImageSlotRecord): boolean {
  return (
    record.state === "ambiguous" &&
    !record.providerTaskId &&
    !record.providerResponseSummary &&
    submitTransportFailureProvesNoPaidTaskAccepted(record.reason || "")
  );
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
    fsyncDirectory(path.dirname(file));
    return { action: "submit", record: reserved };
  }

  return withSlotLock(input.productDir, input.slot, () => {
    const existing = readSlotRecordUnlocked(input.productDir, input.slot);
    if (!existing) {
      throw new Error(`paid image slot ${input.slot} disappeared after reservation conflict`);
    }
    const allowDigestChange =
      input.allowFailedAfterAcceptanceDigestChange === true && existing.state === "failed_after_acceptance";
    if (!allowDigestChange) {
      assertSlotIdentity(existing, input.requestDigest, input.promptDigest);
    }
    if (isAutoRetryableNoAcceptanceAmbiguousRecord(existing)) {
      const failedBeforeAcceptance = transitionSlotUnlocked(input.productDir, input.slot, ["ambiguous"], "failed_before_acceptance", {
        reason: `auto no-acceptance reconciliation: ${existing.reason || "submit transport failed before provider task id"}`
      });
      const reacquired = createReservedRecord(input, failedBeforeAcceptance.audit);
      atomicWriteJson(slotFile(input.productDir, input.slot), reacquired);
      return { action: "submit", record: reacquired };
    }
    if (existing.state !== "failed_before_acceptance" && existing.state !== "failed_after_acceptance") {
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

export function readPaidImageSlotRecord(input: ResolvePaidImageSlotActionInput): PaidImageSlotRecord | undefined {
  return readSlotRecord(input.productDir, input.slot);
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
    audit: [
      ...record.audit,
      {
        state: nextState,
        at,
        ...(changes.reason ? { reason: cleanText(changes.reason) } : {}),
        ...(changes.replayDisposition ? { replayDisposition: changes.replayDisposition } : {})
      }
    ]
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

export function reconcileAmbiguousPaidImageTask(input: ReconcileAmbiguousPaidImageTaskInput): PaidImageSlotRecord {
  if (!isSafeProviderTaskId(input.providerTaskId)) {
    throw new Error("providerTaskId must be a bounded safe scalar");
  }
  validateSlotRange(input.productDir, input.slot);
  return withSlotLock(input.productDir, input.slot, () => {
    const record = readSlotRecordUnlocked(input.productDir, input.slot);
    if (!record || record.state !== "ambiguous") {
      throw new Error(`invalid slot reconciliation for slot ${input.slot}: ${record?.state || "missing"} -> submitted`);
    }
    if (record.providerTaskId && record.providerTaskId !== input.providerTaskId) {
      throw new Error(`provider task id mismatch for ambiguous slot ${input.slot}`);
    }
    for (const file of fs.readdirSync(path.join(input.productDir, "slots"))) {
      const match = /^(\d+)\.json$/.exec(file);
      if (!match || Number(match[1]) === input.slot) {
        continue;
      }
      const other = readSlotRecordUnlocked(input.productDir, Number(match[1]));
      if (other?.providerTaskId === input.providerTaskId) {
        throw new Error(`provider task ${input.providerTaskId} already belongs to slot ${other.slot}`);
      }
    }
    return transitionSlotUnlocked(input.productDir, input.slot, ["ambiguous"], "submitted", {
      providerTaskId: input.providerTaskId,
      reason: cleanText(requireNonEmpty(input.reason, "reason")),
      providerResponseSummary: providerResponseSummary(input.providerResponse)
    });
  });
}

export function reconcileAmbiguousPaidImageNoAcceptance(
  input: ReconcileAmbiguousPaidImageNoAcceptanceInput
): PaidImageSlotRecord {
  validateSlotRange(input.productDir, input.slot);
  return withSlotLock(input.productDir, input.slot, () => {
    const record = readSlotRecordUnlocked(input.productDir, input.slot);
    if (!record || record.state !== "ambiguous") {
      throw new Error(`invalid slot reconciliation for slot ${input.slot}: ${record?.state || "missing"} -> failed_before_acceptance`);
    }
    if (record.providerTaskId) {
      throw new Error(`ambiguous slot ${input.slot} has provider task id ${record.providerTaskId}; reconcile the task instead`);
    }
    return transitionSlotUnlocked(input.productDir, input.slot, ["ambiguous"], "failed_before_acceptance", {
      reason: cleanText(requireNonEmpty(input.reason, "reason"))
    });
  });
}

export function reconcileAmbiguousPaidImageProviderFailure(
  input: ReconcileAmbiguousPaidImageProviderFailureInput
): PaidImageSlotRecord {
  if (!isSafeProviderTaskId(input.providerTaskId)) {
    throw new Error("providerTaskId must be a bounded safe scalar");
  }
  validateSlotRange(input.productDir, input.slot);
  return withSlotLock(input.productDir, input.slot, () => {
    const record = readSlotRecordUnlocked(input.productDir, input.slot);
    if (!record || record.state !== "ambiguous") {
      throw new Error(`invalid slot reconciliation for slot ${input.slot}: ${record?.state || "missing"} -> failed_after_acceptance`);
    }
    if (record.providerTaskId !== input.providerTaskId) {
      throw new Error(`provider task id mismatch for ambiguous slot ${input.slot}`);
    }
    if (!/provider task failed|failed provider task|explicit provider.*fail|legacy ambiguous/i.test(input.reason)) {
      throw new Error(`provider failure reconciliation reason must state the explicit provider failure evidence`);
    }
    return transitionSlotUnlocked(input.productDir, input.slot, ["ambiguous"], "failed_after_acceptance", {
      reason: cleanText(requireNonEmpty(input.reason, "reason"))
    });
  });
}

export function recordPaidImageCompleted(input: RecordPaidImageCompletedInput): PaidImageSlotRecord {
  if (!fs.statSync(input.sourceFile).isFile()) {
    throw new Error(`completed paid image source is not a file: ${input.sourceFile}`);
  }
  if (input.providerTaskId !== undefined && !isSafeProviderTaskId(input.providerTaskId)) {
    throw new Error("providerTaskId must be a bounded safe scalar");
  }
  const sourceDigest = sha256File(input.sourceFile);
  validateSlotRange(input.productDir, input.slot);
  return withSlotLock(input.productDir, input.slot, () => {
    const record = readSlotRecordUnlocked(input.productDir, input.slot);
    if (record?.state === "completed") {
      const sameProviderTask = Boolean(input.providerTaskId) && record.providerTaskId === input.providerTaskId;
      const storedResultIsValid = Boolean(
        record.resultFile &&
          record.resultDigest &&
          fs.existsSync(record.resultFile) &&
          sha256File(record.resultFile) === record.resultDigest
      );
      if (!sameProviderTask || !storedResultIsValid || sourceDigest !== record.resultDigest) {
        throw new Error(`conflicting completed terminal evidence for paid image slot ${input.slot}`);
      }
      return record;
    }
    if (!record || record.state !== "submitted") {
      throw new Error(`invalid slot transition for slot ${input.slot}: ${record?.state || "missing"} -> completed`);
    }
    if (input.providerTaskId && record.providerTaskId !== input.providerTaskId) {
      throw new Error(`provider task id mismatch for completed slot ${input.slot}`);
    }
    const resultFile = path.join(input.productDir, "results", `${String(input.slot).padStart(2, "0")}.png`);
    const tempResult = `${resultFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let tempResultFd: number | undefined;
    try {
      fs.copyFileSync(input.sourceFile, tempResult, fs.constants.COPYFILE_EXCL);
      tempResultFd = fs.openSync(tempResult, "r");
      fs.fsyncSync(tempResultFd);
      fs.closeSync(tempResultFd);
      tempResultFd = undefined;
      fs.renameSync(tempResult, resultFile);
      fsyncDirectory(path.dirname(resultFile));
    } finally {
      if (tempResultFd !== undefined) {
        fs.closeSync(tempResultFd);
      }
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
    providerResponseSummary: providerResponseSummary(input.providerResponse),
    ...(input.replayDisposition ? { replayDisposition: input.replayDisposition } : {})
  });
}

export function recordPaidImageFailedBeforeAcceptance(input: RecordPaidImageFailedBeforeAcceptanceInput): PaidImageSlotRecord {
  return transitionSlot(input.productDir, input.slot, ["reserved"], "failed_before_acceptance", {
    reason: cleanText(requireNonEmpty(input.reason, "reason")),
    ...(input.replayDisposition ? { replayDisposition: input.replayDisposition } : {})
  });
}

export function recordPaidImageFailedAfterAcceptance(input: RecordPaidImageFailedAfterAcceptanceInput): PaidImageSlotRecord {
  if (input.providerTaskId !== undefined && !isSafeProviderTaskId(input.providerTaskId)) {
    throw new Error("providerTaskId must be a bounded safe scalar");
  }
  const reason = cleanText(requireNonEmpty(input.reason, "reason"));
  const responseSummary = providerResponseSummary(input.providerResponse);
  validateSlotRange(input.productDir, input.slot);
  return withSlotLock(input.productDir, input.slot, () => {
    const record = readSlotRecordUnlocked(input.productDir, input.slot);
    if (record?.state === "failed_after_acceptance") {
      const sameProviderTask = Boolean(input.providerTaskId) && record.providerTaskId === input.providerTaskId;
      if (
        !sameProviderTask ||
        record.reason !== reason ||
        record.replayDisposition !== input.replayDisposition ||
        !isDeepStrictEqual(record.providerResponseSummary, responseSummary)
      ) {
        throw new Error(`conflicting failed terminal evidence for paid image slot ${input.slot}`);
      }
      return record;
    }
    if (!record || record.state !== "submitted") {
      throw new Error(
        `invalid slot transition for slot ${input.slot}: ${record?.state || "missing"} -> failed_after_acceptance`
      );
    }
    if (input.providerTaskId && record.providerTaskId !== input.providerTaskId) {
      throw new Error(`provider task id mismatch for failed slot ${input.slot}`);
    }
    return transitionSlotUnlocked(input.productDir, input.slot, ["submitted"], "failed_after_acceptance", {
      reason,
      providerResponseSummary: responseSummary,
      ...(input.replayDisposition ? { replayDisposition: input.replayDisposition } : {})
    });
  });
}

export function expireSubmittedPaidImageQueue(input: ExpireSubmittedPaidImageQueueInput): PaidImageSlotRecord | undefined {
  if (!Number.isFinite(input.minSubmittedAgeMs) || input.minSubmittedAgeMs < 0) {
    throw new Error("minSubmittedAgeMs must be a non-negative finite number");
  }
  validateSlotRange(input.productDir, input.slot);
  return withSlotLock(input.productDir, input.slot, () => {
    const record = readSlotRecordUnlocked(input.productDir, input.slot);
    if (!record || record.state !== "submitted") {
      return undefined;
    }
    let submittedAt = record.updatedAt || record.createdAt;
    for (let index = record.audit.length - 1; index >= 0; index -= 1) {
      if (record.audit[index]?.state === "submitted") {
        submittedAt = record.audit[index].at;
        break;
      }
    }
    const ageMs = Date.now() - Date.parse(submittedAt);
    if (!Number.isFinite(ageMs) || ageMs < input.minSubmittedAgeMs) {
      return undefined;
    }
    return transitionSlotUnlocked(input.productDir, input.slot, ["submitted"], "failed_after_acceptance", {
      reason: cleanText(requireNonEmpty(input.reason, "reason")),
      providerResponseSummary: record.providerResponseSummary
    });
  });
}

function scanPaidImageProductLedger(
  productDir: string,
  expectedIdentity?: PaidImageLedgerExpectedIdentity
): PaidImageLedgerAuditInspection {
  const product = readProductLedger(productDir, expectedIdentity);
  const summary: PaidImageLedgerSummary = {
    expectedSlotCount: product.expectedSlotCount,
    missing: product.expectedSlotCount,
    reserved: 0,
    submitted: 0,
    completed: 0,
    failedBeforeAcceptance: 0,
    failedAfterAcceptance: 0,
    ambiguous: 0
  };
  const errors: PaidImageLedgerArtifactIntegrityIssue[] = [];
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
    if (file !== `${String(slot).padStart(2, "0")}.json`) {
      throw new Error(`noncanonical paid image slot ledger file: ${file}`);
    }
    const record = readSlotRecord(productDir, slot);
    if (!record) {
      throw new Error(`paid image slot ${slot} disappeared while summarizing ledger`);
    }
    if (record.state === "failed_before_acceptance") {
      summary.missing -= 1;
      summary.failedBeforeAcceptance += 1;
    } else if (record.state === "failed_after_acceptance") {
      summary.missing -= 1;
      summary.failedAfterAcceptance += 1;
    } else if (record.state === "completed") {
      let resultIsValid = false;
      try {
        const resultsDir = path.join(path.resolve(productDir), "results");
        const canonicalResultFile = path.join(resultsDir, `${String(record.slot).padStart(2, "0")}.png`);
        const resultsStat = fs.lstatSync(resultsDir);
        const resultStat = fs.lstatSync(canonicalResultFile);
        const realProductDir = fs.realpathSync(path.resolve(productDir));
        const realResultsDir = fs.realpathSync(resultsDir);
        resultIsValid = Boolean(
          record.resultFile === canonicalResultFile &&
          resultsStat.isDirectory() &&
          !resultsStat.isSymbolicLink() &&
          resultStat.isFile() &&
          !resultStat.isSymbolicLink() &&
          realResultsDir === path.join(realProductDir, "results") &&
          fs.realpathSync(canonicalResultFile) === path.join(realResultsDir, `${String(record.slot).padStart(2, "0")}.png`) &&
          record.resultDigest &&
          sha256File(canonicalResultFile) === record.resultDigest
        );
      } catch {
        resultIsValid = false;
      }
      if (!resultIsValid) {
        errors.push({
          code: "completed_result_missing_or_invalid",
          slot: record.slot,
          message: `completed paid image result is missing or invalid for slot ${record.slot}`
        });
        continue;
      }
      summary.missing -= 1;
      summary.completed += 1;
    } else {
      summary.missing -= 1;
      summary[record.state] += 1;
    }
  }
  return { summary, errors };
}

export function summarizePaidImageProductLedger(productDir: string): PaidImageLedgerSummary;
export function summarizePaidImageProductLedger(productDir: string, mode: "audit"): PaidImageLedgerAuditInspection;
export function summarizePaidImageProductLedger(
  productDir: string,
  mode: "audit",
  expectedIdentity: PaidImageLedgerExpectedIdentity
): PaidImageLedgerAuditInspection;
export function summarizePaidImageProductLedger(
  productDir: string,
  mode?: "audit",
  expectedIdentity?: PaidImageLedgerExpectedIdentity
): PaidImageLedgerSummary | PaidImageLedgerAuditInspection {
  const inspected = scanPaidImageProductLedger(productDir, expectedIdentity);
  if (mode === "audit") {
    return inspected;
  }
  if (inspected.errors.length > 0) {
    throw new Error(inspected.errors[0].message);
  }
  return inspected.summary;
}

export function inspectPaidImageProductLedgerForAudit(productDir: string): PaidImageLedgerAuditInspection {
  return summarizePaidImageProductLedger(productDir, "audit");
}
