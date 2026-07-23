import assert from "node:assert/strict";
import fs from "node:fs";

const gatewayRunPath =
  "/Users/mfrank/.local/share/uv/tools/hermes-agent/lib/python3.11/site-packages/gateway/run.py";

assert.equal(
  fs.existsSync(gatewayRunPath),
  true,
  "Hermes gateway run.py must exist so the project can audit the external auto-listing feedback watchdog"
);

const source = fs.readFileSync(gatewayRunPath, "utf8");

assert.match(
  source,
  /hermesProgress/,
  "Hermes gateway watchdog must consume the project-owned hermesProgress payload"
);
assert.match(
  source,
  /last_hermes_progress_key/,
  "Hermes gateway watchdog must record the full hermesProgress.key as the heartbeat"
);
assert.match(
  source,
  /last_hermes_progress_notice_key/,
  "Hermes gateway watchdog must dedupe realtime notices by a stable message-level key"
);
assert.match(
  source,
  /hermes_progress_key_parts\[:8\].*hermes_progress_key_parts\[9:\]/s,
  "Hermes gateway watchdog notice key must ignore timestamp-only hermesProgress.key changes"
);
assert.match(
  source,
  /last_hermes_progress_message/,
  "Hermes gateway watchdog must remember the last delivered hermesProgress.message"
);
assert.match(
  source,
  /_handle_autolist_command\(action,\s*event\)/,
  "auto-listing commands must pass their exact message origin into the controller bridge"
);
assert.match(
  source,
  /_save_autolist_watchdog_origin\(event\.source\)/,
  "start, continue, and status commands must bind proactive progress to the user's active chat/thread"
);
assert.match(
  source,
  /reply_to_message_id/,
  "thread-bound proactive progress must reply inside the originating Feishu thread"
);
assert.match(
  source,
  /adapter\.send\([\s\S]{0,240}reply_to\s*=\s*reply_to_message_id/,
  "every proactive notice must be a direct reply to the exact start/continue/status command message"
);
const noticeSender = source.slice(
  source.indexOf("async def _send_autolist_notice"),
  source.indexOf("async def _autolist_watchdog")
);
assert.doesNotMatch(
  noticeSender,
  /channel_directory|get_home_channel/,
  "proactive notices must fail closed instead of guessing a stale directory or home channel"
);
assert.match(
  source,
  /if\s+not\s+delivered:[\s\S]{0,300}state\s*=\s*state_before_notice/,
  "a failed delivery must not advance the watchdog dedupe state and suppress all retries"
);
assert.match(
  source,
  /platform\s*==\s*Platform\.FEISHU[\s\S]{0,180}message_id/,
  "Feishu delivery is not confirmed unless the API returns a concrete message ID"
);
assert.doesNotMatch(
  source,
  /summary\["safelyPublished"\]\s*>\s*int\(state\.get\("last_safely_published"\)/,
  "Hermes gateway watchdog must not gate realtime notices on cross-product last_safely_published state"
);
assert.doesNotMatch(
  source,
  /state\.get\("last_hermes_progress_key"\)\s*!=\s*hermes_progress_key:\s*\n\s*notice_kind = "progress"/,
  "Hermes gateway watchdog must not send a notice for every timestamp-only hermesProgress.key change"
);
assert.doesNotMatch(
  source,
  /f"\{job_key\}:\{summary\['realtimeSource'\]\}:\{summary\['realtimeMessage'\]\}"/,
  "Hermes gateway watchdog must not include latest-artifact text in the stable notice key"
);
assert.match(
  source,
  /elif not hermes_progress_key and summary\["imageMessage"\]/,
  "Hermes gateway watchdog must not fall back to image progress while project-owned hermesProgress is available"
);
assert.match(
  source,
  /elif not hermes_progress_key and progress_key/,
  "Hermes gateway watchdog must not fall back to legacy publish progress while project-owned hermesProgress is available"
);
assert.match(
  source,
  /realtimeMessage/,
  "Hermes gateway progress notices must report the project-owned hermesProgress.message"
);
const terminalBranchIndex = source.indexOf('if summary["status"] == "failed":');
const progressBranchIndex = source.indexOf('elif hermes_progress_key and state.get("last_hermes_progress_notice_key")');
assert.ok(terminalBranchIndex >= 0, "Hermes gateway watchdog must have an explicit terminal failure branch");
assert.ok(
  terminalBranchIndex < progressBranchIndex,
  "Hermes gateway watchdog must deliver terminal failure before considering stale realtime progress"
);
assert.match(
  source,
  /terminal_key.*summary\["status"\].*summary\["summary"\]/s,
  "Hermes terminal notices must dedupe by terminal status and project failure summary"
);
assert.match(
  source,
  /kind == "stopped"[\s\S]*summary\.get\("realtimeMessage"\)[\s\S]*进度：\{summary\['realtimeMessage'\]\}/,
  "Hermes pause/stopped notices must use the project-owned progress message instead of hidden cumulative publish fields."
);
