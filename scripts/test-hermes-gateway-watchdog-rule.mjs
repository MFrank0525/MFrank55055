import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";

const gatewayRunPath =
  "/Users/mfrank/.local/share/uv/tools/hermes-agent/lib/python3.11/site-packages/gateway/run.py";
const hermesHome = process.env.HERMES_HOME || "/Users/mfrank/.hermes/profiles/doudian-listing";
const autoListingRouterPluginPath = `${hermesHome}/plugins/auto-listing-command-router/__init__.py`;
const canonicalAutoListingRouterPluginPath =
  "integrations/hermes/auto-listing-command-router/__init__.py";
const hermesConfigPath = `${hermesHome}/config.yaml`;

assert.equal(
  fs.existsSync(gatewayRunPath),
  true,
  "Hermes gateway run.py must exist so the project can audit the external auto-listing feedback watchdog"
);

const source = fs.readFileSync(gatewayRunPath, "utf8");
assert.equal(
  fs.existsSync(autoListingRouterPluginPath),
  true,
  "Hermes must install a user plugin that survives package upgrades and routes natural-language auto-listing controls before the LLM"
);
const routerSource = fs.readFileSync(autoListingRouterPluginPath, "utf8");
assert.equal(
  fs.existsSync(canonicalAutoListingRouterPluginPath),
  true,
  "The durable Hermes router source must be versioned with the project"
);
const canonicalRouterSource = fs.readFileSync(canonicalAutoListingRouterPluginPath, "utf8");
assert.equal(
  routerSource,
  canonicalRouterSource,
  "The installed Hermes router must exactly match the project-owned canonical source"
);
const hermesConfigSource = fs.readFileSync(hermesConfigPath, "utf8");
assert.match(routerSource, /pre_gateway_dispatch/);
assert.match(routerSource, /"开始上架":\s*"start"/);
assert.match(routerSource, /"继续上架":\s*"continue"/);
assert.match(routerSource, /"暂停上架":\s*"pause"/);
assert.match(routerSource, /"上架(?:状态|进度)":\s*"status"/);
assert.match(
  routerSource,
  /"action":\s*"skip"[\s\S]*"auto-listing-control-handled"/,
  "Natural-language controls must finish gateway dispatch immediately instead of entering the synchronous slash-command path"
);
assert.match(
  hermesConfigSource,
  /plugins:\s*[\s\S]*enabled:\s*[\s\S]*auto-listing-command-router/,
  "The durable natural-language router plugin must be explicitly enabled"
);
childProcess.execFileSync(
  "/Users/mfrank/.local/share/uv/tools/hermes-agent/bin/python",
  ["scripts/test-hermes-auto-listing-command-router.py"],
  { cwd: process.cwd(), stdio: "inherit" }
);

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
  /_save_autolist_watchdog_origin\(event\.source,\s*self\._reply_anchor_for_event\(event\)\)/,
  "start, continue, and status commands must bind proactive progress to the exact triggering message"
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
assert.match(
  noticeSender,
  /if not reply_to_message_id:[\s\S]{0,240}return False/,
  "A missing exact command message ID must fail closed instead of sending an unthreaded notice"
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
  /last_service_wait_notice_at[\s\S]{0,500}10\s*\*\s*60/,
  "An unchanged accepted-task queue wait must still emit a verified liveness notice every ten minutes"
);
assert.match(
  source,
  /summary\.get\("realtimeMessage"\)[\s\S]{0,300}service_wait/,
  "Service-wait notices must expose the project-owned realtime queue message"
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
assert.match(
  routerSource,
  /reply_to_message_id[\s\S]*getattr\(event,\s*"message_id"/,
  "The durable user plugin must preserve the triggering message ID across Hermes package upgrades"
);
