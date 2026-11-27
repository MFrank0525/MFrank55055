import fs from "node:fs";
import path from "node:path";

interface LocalFeishuAuthConfig {
  auth?: {
    appId?: string;
    appSecret?: string;
    tenantAccessToken?: string;
  };
}

export function loadLocalFeishuAuthEnv(configFile: string): void {
  const resolved = path.resolve(configFile);
  if (!fs.existsSync(resolved)) return;
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as LocalFeishuAuthConfig;
  if (parsed.auth?.appId?.trim()) process.env.FEISHU_APP_ID = parsed.auth.appId.trim();
  if (parsed.auth?.appSecret?.trim()) process.env.FEISHU_APP_SECRET = parsed.auth.appSecret.trim();
  if (parsed.auth?.tenantAccessToken?.trim()) {
    process.env.FEISHU_TENANT_ACCESS_TOKEN = parsed.auth.tenantAccessToken.trim();
  }
}
