import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_SCOPES = Object.freeze([
  "im:message",
  "im:message.group_at_msg:readonly",
]);

function hasInboundProof(inboundState) {
  return Boolean(
    inboundState &&
      typeof inboundState === "object" &&
      inboundState.message_ids &&
      Object.keys(inboundState.message_ids).length > 0,
  );
}

export function evaluateChannelHealth({
  scopes = [],
  gatewayLog = "",
  connectionMode = "",
  requireInbound = false,
  inboundState,
}) {
  const issues = [];
  const scopeSet = new Set(scopes);
  const missingScopes = REQUIRED_SCOPES.filter((scope) => !scopeSet.has(scope));

  if (missingScopes.length > 0) {
    issues.push(`缺少飞书消息权限：${missingScopes.join(", ")}`);
  }

  if (connectionMode !== "websocket") {
    issues.push("FEISHU_CONNECTION_MODE 必须为 websocket");
  }

  const connectedAt = gatewayLog.lastIndexOf("[Feishu] Connected in websocket mode");
  const disconnectedAt = gatewayLog.lastIndexOf("[Feishu] Disconnected");
  if (connectedAt < 0 || connectedAt < disconnectedAt) {
    issues.push("Hermes 飞书长连接当前未连接");
  }

  const inboundVerified = hasInboundProof(inboundState);
  if (requireInbound && !inboundVerified) {
    issues.push("尚无入站消息证据；请向机器人发送“状态”后重试");
  }

  return {
    ok: issues.length === 0,
    issues,
    checks: {
      requiredScopes: missingScopes.length === 0,
      websocketConfigured: connectionMode === "websocket",
      websocketConnected: connectedAt >= 0 && connectedAt >= disconnectedAt,
      inboundVerified,
    },
  };
}

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(`飞书 API 检查失败：code=${payload.code ?? response.status} msg=${payload.msg ?? response.statusText}`);
  }
  return payload;
}

async function fetchGrantedScopes(appId, appSecret) {
  const tokenPayload = await requestJson(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );
  const scopePayload = await requestJson(
    "https://open.feishu.cn/open-apis/application/v6/scopes",
    {
      headers: { Authorization: `Bearer ${tokenPayload.tenant_access_token}` },
    },
  );
  return (scopePayload.data?.scopes ?? []).map((scope) => scope.scope_name);
}

async function main() {
  const profileFlag = process.argv.indexOf("--profile");
  const profile = profileFlag >= 0 ? process.argv[profileFlag + 1] : "";
  const requireInbound = process.argv.includes("--require-inbound");

  if (!profile) {
    throw new Error("用法：node scripts/hermes-channel-doctor.mjs --profile <profile> [--require-inbound]");
  }

  const profileDir = path.join(homedir(), ".hermes", "profiles", profile);
  const env = parseEnv(await readFile(path.join(profileDir, ".env"), "utf8"));
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    throw new Error(`Hermes profile ${profile} 缺少 FEISHU_APP_ID/FEISHU_APP_SECRET`);
  }

  const [scopes, gatewayLog, inboundState] = await Promise.all([
    fetchGrantedScopes(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET),
    readFile(path.join(profileDir, "logs", "gateway.log"), "utf8"),
    readJsonIfPresent(path.join(profileDir, "feishu_seen_message_ids.json")),
  ]);

  const result = evaluateChannelHealth({
    scopes,
    gatewayLog,
    connectionMode: env.FEISHU_CONNECTION_MODE,
    requireInbound,
    inboundState,
  });

  console.log(JSON.stringify({ profile, ...result }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
