import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface PaidImageGatewayEvidence {
  relativeFile: string;
  sha256: string;
  httpStatus: number;
  capturedAt: string;
}

export function isPaidImageGatewayEvidence(value: unknown): value is PaidImageGatewayEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as PaidImageGatewayEvidence;
  return /^evidence\/slot-\d{2}-[a-f0-9]{64}\.response$/.test(evidence.relativeFile) &&
    /^[a-f0-9]{64}$/.test(evidence.sha256) && Number.isInteger(evidence.httpStatus) &&
    evidence.httpStatus >= 100 && evidence.httpStatus <= 599 && typeof evidence.capturedAt === "string";
}

export function persistPaidImageGatewayEvidence(input: {
  productDir: string; slot: number; sourceFile: string; httpStatus: number;
}): PaidImageGatewayEvidence {
  if (!fs.existsSync(input.sourceFile) || !fs.statSync(input.sourceFile).isFile()) {
    throw new Error(`slot ${input.slot} provider response evidence file is missing`);
  }
  const content = fs.readFileSync(input.sourceFile);
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");
  const relativeFile = `evidence/slot-${String(input.slot).padStart(2, "0")}-${sha256}.response`;
  const target = path.join(input.productDir, relativeFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) {
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      fd = fs.openSync(temporary, "wx");
      fs.writeFileSync(fd, content);
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, target);
      const directoryFd = fs.openSync(path.dirname(target), "r");
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  } else if (!fs.readFileSync(target).equals(content)) {
    throw new Error(`slot ${input.slot} canonical provider response evidence conflicts with its digest`);
  }
  return { relativeFile, sha256, httpStatus: input.httpStatus, capturedAt: new Date().toISOString() };
}

export function resolvePaidImageGatewayEvidenceFile(productDir: string, evidence: PaidImageGatewayEvidence): string {
  if (!isPaidImageGatewayEvidence(evidence)) throw new Error("invalid paid image gateway evidence metadata");
  const file = path.resolve(productDir, evidence.relativeFile);
  const evidenceRoot = path.resolve(productDir, "evidence") + path.sep;
  if (!file.startsWith(evidenceRoot)) throw new Error("paid image gateway evidence escaped its product ledger");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("paid image gateway evidence file is missing");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (digest !== evidence.sha256) throw new Error("paid image gateway evidence digest mismatch");
  return file;
}
