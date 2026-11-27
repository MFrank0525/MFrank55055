interface TenantAccessTokenResponse {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  let lastError: unknown;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let shouldRetry = true;
    try {
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
      if (response.ok && payload.code === 0 && payload.tenant_access_token) return payload.tenant_access_token;
      const error = new Error(
        `Could not get Feishu tenant_access_token: code=${payload.code}; msg=${payload.msg || response.statusText}`
      );
      shouldRetry = [408, 429, 500, 502, 503, 504].includes(response.status);
      if (!shouldRetry || attempt === maxAttempts) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (!shouldRetry || attempt === maxAttempts) throw error;
    }
    await sleep(1000 * attempt);
  }
  throw lastError instanceof Error ? lastError : new Error("Could not get Feishu tenant_access_token.");
}
