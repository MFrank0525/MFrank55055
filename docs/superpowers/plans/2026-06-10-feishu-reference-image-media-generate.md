# Feishu Reference Image Media Generate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed Feishu white-background product images into lk888 `media-generate` as image-to-image references.

**Architecture:** Preserve Feishu attachment reference metadata, upload the matched product's local white-background image to a short-lived public file URL, pass that URL into the image provider, and require it before any paid async media generation task is submitted.

**Tech Stack:** TypeScript, Node fetch, existing Feishu Bitable asset pipeline, existing `openai-compatible` image provider.

---

### Task 1: Preserve Feishu Reference URL

**Files:**
- Modify: `src/feishu/types.ts`
- Modify: `src/feishu/assets.ts`
- Modify: `src/feishu/product-records.ts`

- [ ] Add `providerReferenceUrl?: string` to `FeishuBitableAttachment`.
- [ ] Populate it from `temporaryUrl || downloadUrl` during attachment extraction and asset download.
- [ ] Keep it in sanitized records only as a redacted marker, not the raw URL.

### Task 2: Pass Reference URL Into Image Provider

**Files:**
- Modify: `src/autolist/jimeng-assets.ts`
- Modify: `src/autolist/orchestrator.ts`

- [ ] Add `sourceImageReferenceUrl?: string` to main image generation options.
- [ ] Resolve the URL from the current Feishu record's first white-background attachment.
- [ ] Upload the local Feishu white-background source image to tmpfiles when no explicit `mediaParams.images` is configured.
- [ ] In `media-generate`, set `params.images` to the tmpfiles direct URL when not already explicitly configured.
- [ ] Fail before submit if the public reference upload fails.

### Task 3: Regression Rules And Verification

**Files:**
- Modify: `scripts/test-image-provider-media-generate-rule.mjs`
- Modify: `package.json` only if a new script is needed.

- [ ] Extend the existing media-generate rule test to check the Feishu reference URL path.
- [ ] Run `npm run build`.
- [ ] Run `npm run rules:check`.
- [ ] Run `npm run doctor:auto-listing -- --image-generation-provider openai-compatible --image-generation-config ./input/image-generation.config.json --require-image-generation`.

### Task 4: Single Real Image-To-Image Test

**Files:**
- Runtime only, no committed secret files.

- [ ] Confirm direct unauthenticated Feishu URL access fails.
- [ ] Upload the current local Feishu white-background image to tmpfiles and confirm the `/dl/` direct URL returns `image/png`.
- [ ] Submit exactly one `media-generate` image task with `params.images` set to that tmpfiles direct URL.
- [ ] Poll `/v1/skills/task-status`.
- [ ] Download the resulting image to `data/auto-listing/provider-tests/`.
- [ ] Verify the image is PNG and `1024x1024`.
