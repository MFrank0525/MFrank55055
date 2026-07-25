export function isDoudianLoginRequiredFailure(message: string): boolean {
  return /Doudian login (?:is )?required|doudian_login_required|抖店登录(?:已失效|.*需要|.*required)?/i.test(message);
}

export function resolveDoudianLoginRecoveryPollMs(): number {
  return 30_000;
}

export function formatAutoListingControllerDoudianLoginWaitSummary(input: {
  retryAt?: string;
  nowMs: number;
}): string {
  const retryAtMs = Date.parse(input.retryAt || "");
  const remainingSeconds = Number.isFinite(retryAtMs)
    ? Math.max(0, Math.ceil((retryAtMs - input.nowMs) / 1000))
    : undefined;
  const countdown = remainingSeconds === undefined ? "稍后" : `${remainingSeconds}秒后`;
  return `抖店登录已失效；请在项目固定有头浏览器完成登录。系统保持原断点，${countdown}只读复检，确认登录恢复后自动继续。`;
}

export function formatAutoListingControllerExternalServiceWaitSummary(input: {
  retryAt?: string;
  nowMs: number;
  reason?: string;
}): string {
  const retryAtMs = Date.parse(input.retryAt || "");
  const remainingSeconds = Number.isFinite(retryAtMs) ? Math.max(0, Math.ceil((retryAtMs - input.nowMs) / 1000)) : undefined;
  const countdown = remainingSeconds === undefined ? "供应商恢复后" : `${Math.floor(remainingSeconds / 60)}分${remainingSeconds % 60}秒后`;
  const slot = /timeout circuit open for slot\s+(\d+)/i.exec(input.reason || "")?.[1];
  return `图片服务冷却中：${slot ? `槽位 ${slot}；` : ""}${countdown}（${input.retryAt || "时间待定"}）自动重试。`;
}

export function formatAutoListingControllerWaitSummary(input: {
  status: string;
  retryAt?: string;
  nowMs: number;
  reason?: string;
}): string {
  return input.status === "doudian_login_wait"
    ? formatAutoListingControllerDoudianLoginWaitSummary(input)
    : formatAutoListingControllerExternalServiceWaitSummary(input);
}

export function resolveDoudianLoginWaitRealtimeMessage(status: string): string | undefined {
  return status === "doudian_login_wait"
    ? "抖店登录已失效；系统正在保留原断点并等待固定有头浏览器恢复登录。"
    : undefined;
}
