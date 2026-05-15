interface TenantAccessTokenResponse {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

export function getConfiguredTenantAccessToken(): string {
  return (process.env.FEISHU_TENANT_ACCESS_TOKEN || "").trim();
}

export function assertFeishuAuthConfigReady(): void {
  if (getConfiguredTenantAccessToken()) {
    return;
  }
  if (!process.env.FEISHU_APP_ID?.trim() || !process.env.FEISHU_APP_SECRET?.trim()) {
    throw new Error(
      [
        "Feishu authorization is required.",
        "Set FEISHU_TENANT_ACCESS_TOKEN, or set both FEISHU_APP_ID and FEISHU_APP_SECRET.",
        "The Feishu app also needs Bitable read permissions and access to the target base."
      ].join(" ")
    );
  }
}

export async function getTenantAccessToken(): Promise<string> {
  const configured = getConfiguredTenantAccessToken();
  if (configured) {
    return configured;
  }

  assertFeishuAuthConfigReady();
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET
    })
  });

  const payload = (await response.json()) as TenantAccessTokenResponse;
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(`Could not get Feishu tenant_access_token: code=${payload.code}; msg=${payload.msg || response.statusText}`);
  }

  return payload.tenant_access_token;
}
