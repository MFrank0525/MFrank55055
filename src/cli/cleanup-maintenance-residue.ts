import path from "node:path";
import { cleanupMaintenanceResidue } from "../autolist/cleanup.js";
import { collectPreviousBatchArtifactTargets, writeIdleFeishuCache } from "../autolist/maintenance-inventory.js";
import {
  filterMaintenanceResidueTargetsByScope,
  selectMaintenanceResidueTargets,
  type MaintenanceCleanupScope
} from "../autolist/maintenance-rules.js";

function main(): void {
  const workspaceRoot = process.cwd();
  const apply = process.argv.includes("--apply");
  const scope: MaintenanceCleanupScope = process.argv.includes("--all") ? "all" : "control-logs";
  const inventory = collectPreviousBatchArtifactTargets(workspaceRoot);
  const classifiedTargets = selectMaintenanceResidueTargets({ filePaths: inventory });
  const targets = scope === "all"
    ? inventory
    : filterMaintenanceResidueTargetsByScope(classifiedTargets, scope).map((target) => target.filePath);
  const result = cleanupMaintenanceResidue({ targets, apply, workspaceRoot });
  const idleFeishuCache = apply && scope === "all" ? writeIdleFeishuCache(workspaceRoot) : undefined;
  process.stdout.write(`${JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    scope,
    selectedCount: result.selectedPaths.length,
    removedCount: result.removedPaths.length,
    selectedPaths: result.selectedPaths.map((item) => path.relative(workspaceRoot, item)),
    removedPaths: result.removedPaths.map((item) => path.relative(workspaceRoot, item)),
    idleFeishuCache: idleFeishuCache ? path.relative(workspaceRoot, idleFeishuCache) : undefined
  }, null, 2)}\n`);
}

main();
