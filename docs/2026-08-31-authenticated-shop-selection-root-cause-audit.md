# Authenticated shop-selection root-cause audit

## Incident

The operator had completed Doudian authentication, but auto-listing continued to report that login was required. Runtime evidence showed the browser on `/login/common` with the authenticated `请选择店铺` workspace chooser, visible authorized shops, account-role labels, and `正常营业` status.

## Root cause

The session preflight used an over-broad route invariant: every `/login` or `/passport` URL was classified as logged out. Doudian also serves its authenticated shop chooser from `/login/common`, so URL-only classification collapsed two distinct states:

1. unauthenticated login form;
2. authenticated session awaiting workspace/shop selection.

The long-lived supervisor also retained the pre-fix module in memory until it was restarted at a verified wait-only boundary.

## Systemic correction

- Session readiness now has three explicit states: logged out, authenticated shop selection required, and SPU workspace ready.
- Logged-out detection still fails closed for an explicit login route with missing/unavailable body text.
- The authenticated chooser requires the combined page semantics `请选择店铺`, `抖店工作台`, account-role text, and `正常营业`; a route alone cannot establish this state.
- Preflight selects one visible exact shop-name control through a DOM locator, then navigates to and verifies the SPU workspace.
- No coordinate click, synthetic pointer event, or ambiguous text click is used.
- The stale supervisor was stopped only at a login-wait boundary with no active publish child or unresolved submit action, then the exact batch and manifest checkpoint were resumed.

## Live verification

After restarting with the corrected code, batch `21a53425746de97ae01f9a02` resumed product 14/20 at publish target 15/20. The real run passed login preflight, opened target shop `15延草纲目养生器械专营店`, queried SPU `黔械注准20252140234`, filled basic information, and advanced to `graphic_info`.

## Regression contract

`scripts/test-platform-spu-query-page-rule.mjs` covers both:

- empty-body `/login/common` remains login-required;
- authenticated shop-chooser content on `/login/common` is not reported as logged out.

