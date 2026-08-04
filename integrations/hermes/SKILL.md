---
name: douyin-auto-listing-project
description: Direct Hermes control for the Doudian full-flow auto-listing project in /Users/mfrank/MFrank55055.
---

# Douyin Auto Listing Hermes Control

Hermes is only the launcher, pauser, status reporter, error reporter, and result notifier for `/Users/mfrank/MFrank55055`. Business logic, browser work, recovery identity, paid-image bookkeeping, and Doudian submission remain project-owned.

Use only these commands from the project root:

- `开始上架`: `npm run auto-listing:hermes-start`
- `继续上架` / `恢复上架`: `npm run auto-listing:hermes-continue`
- `暂停上架` / `停止上架`: `npm run auto-listing:hermes-pause`
- `上架状态` / `上架进度`: `npm run auto-listing:hermes-status`

Start refreshes Feishu and locks the refreshed batch. Continue never refreshes or switches batches. Return the compact project output without an LLM reasoning turn. Never execute lower-level flow, image, browser, or publish commands from Hermes.
