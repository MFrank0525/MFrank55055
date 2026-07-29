import fs from "node:fs";
import path from "node:path";

interface BrowserProfileLease {
  pid: number;
  acquiredAt: string;
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLease(leaseFile: string): BrowserProfileLease {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(leaseFile, "utf8"));
  } catch {
    throw new Error(`Doudian browser profile lease is unreadable: ${leaseFile}`);
  }
  const lease = parsed as Partial<BrowserProfileLease>;
  if (!Number.isInteger(lease.pid) || (lease.pid || 0) <= 0 || typeof lease.acquiredAt !== "string") {
    throw new Error(`Doudian browser profile lease is invalid: ${leaseFile}`);
  }
  return lease as BrowserProfileLease;
}

export function acquireBrowserProfileLease(input: {
  leaseFile: string;
  ownerPid?: number;
  isPidAlive?: (pid: number) => boolean;
  now?: () => Date;
}): void {
  const ownerPid = input.ownerPid || process.pid;
  const isPidAlive = input.isPidAlive || defaultIsPidAlive;
  fs.mkdirSync(path.dirname(input.leaseFile), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const descriptor = fs.openSync(input.leaseFile, "wx");
      try {
        fs.writeFileSync(
          descriptor,
          `${JSON.stringify({ pid: ownerPid, acquiredAt: (input.now || (() => new Date()))().toISOString() }, null, 2)}\n`
        );
      } finally {
        fs.closeSync(descriptor);
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
    const existing = readLease(input.leaseFile);
    if (existing.pid === ownerPid) {
      return;
    }
    if (isPidAlive(existing.pid)) {
      throw new Error(
        `Doudian browser profile is owned by active process PID ${existing.pid}; refusing concurrent automation.`
      );
    }
    fs.rmSync(input.leaseFile, { force: true });
  }
  throw new Error(`Could not acquire Doudian browser profile lease: ${input.leaseFile}`);
}

export function releaseBrowserProfileLease(input: { leaseFile: string; ownerPid?: number }): void {
  if (!fs.existsSync(input.leaseFile)) {
    return;
  }
  const ownerPid = input.ownerPid || process.pid;
  const existing = readLease(input.leaseFile);
  if (existing.pid === ownerPid) {
    fs.rmSync(input.leaseFile, { force: true });
  }
}
