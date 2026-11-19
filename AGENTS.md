# Repository Delivery Rules

- After every project update, run the verification required by the auto-listing project rules, commit the verified source changes, and push the commit to the current GitHub main branch before reporting delivery complete.
- Do not leave an implemented update only in the local working tree unless the user explicitly asks not to commit or push.
- Never stage or push secrets, local configuration, browser profiles, cookies, generated runtime data, screenshots, Playwright logs, or final generated image archives.
- Preserve the active auto-listing runtime and its locked Feishu batch while preparing source-code delivery.
