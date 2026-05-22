import type { PublishActionResult } from "./types.js";

export function makePublishActionResult(input: PublishActionResult): PublishActionResult {
  return {
    action: input.action,
    ok: input.ok,
    issue: input.issue,
    screenshotFile: input.screenshotFile,
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle
  };
}
