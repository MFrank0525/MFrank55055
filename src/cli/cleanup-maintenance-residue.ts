import path from "node:path";
import { cleanupMaintenanceResidue } from "../autolist/cleanup.js";
import { collectPreviousBatchArtifactTargets, writeIdleFeishuCache } from "../autolist/maintenance-inventory.js";

function main(): void {
  const workspaceRoot = process.cwd();
  const apply = process.argv.includes("--apply");
  const targets = collectPreviousBatchArtifactTargets(workspaceRoot);
  const result = cleanupMaintenanceResidue({ targets, apply, workspaceRoot });
  const idleFeishuCache = apply ? writeIdleFeishuCache(workspaceRoot) : undefined;
  process.stdout.write(`${JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    selectedCount: result.selectedPaths.length,
    removedCount: result.removedPaths.length,
    selectedPaths: result.selectedPaths.map((item) => path.relative(workspaceRoot, item)),
    removedPaths: result.removedPaths.map((item) => path.relative(workspaceRoot, item)),
    idleFeishuCache: idleFeishuCache ? path.relative(workspaceRoot, idleFeishuCache) : undefined
  }, null, 2)}\n`);
}

main();
