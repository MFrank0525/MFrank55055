import assert from "node:assert/strict";
import { resolveControllerJobClosure } from "../dist/src/autolist/maintenance-rules.js";

assert.deepEqual(
  resolveControllerJobClosure({ declaredStatus: "running", processAlive: false, terminalResult: "completed" }),
  { action: "write_terminal", status: "completed" }
);
assert.deepEqual(
  resolveControllerJobClosure({ declaredStatus: "running", processAlive: false, terminalResult: "failed" }),
  { action: "write_terminal", status: "failed" }
);
assert.deepEqual(
  resolveControllerJobClosure({ declaredStatus: "running", processAlive: false }),
  { action: "clear_stale", status: "failed" }
);
assert.deepEqual(
  resolveControllerJobClosure({ declaredStatus: "running", processAlive: true }),
  { action: "keep_running", status: "running" }
);

console.log("controller terminal cleanup rules passed");
