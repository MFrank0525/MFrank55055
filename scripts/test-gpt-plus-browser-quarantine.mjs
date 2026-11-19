import assert from "node:assert/strict";
import { installGptPlusQuotaGuard } from "../dist/src/utils/gpt-plus-guard.js";

const calls = [];
let blockedPageClosed = false;
let routeHandler;
const blockedPage = {
  url: () => "https://chatgpt.com/",
  isClosed: () => blockedPageClosed,
  close: async () => {
    blockedPageClosed = true;
    calls.push("close");
  }
};
const shopPage = {
  url: () => "https://fxg.jinritemai.com/ffa/g/spu-record",
  isClosed: () => false,
  close: async () => {
    throw new Error("the Doudian workspace page must not be closed");
  }
};
const context = {
  pages: () => [blockedPage, shopPage].filter((page) => !page.isClosed()),
  route: async (_pattern, handler) => {
    routeHandler = handler;
    calls.push("route");
  }
};

await installGptPlusQuotaGuard(context);
assert.deepEqual(calls, ["route", "close"]);

let laterPageClosed = false;
const laterPage = {
  isClosed: () => laterPageClosed,
  close: async () => {
    laterPageClosed = true;
  }
};
const request = {
  url: () => "https://chat.openai.com/backend-api/models",
  frame: () => ({ page: () => laterPage })
};
await routeHandler({
  request: () => request,
  abort: async (reason) => assert.equal(reason, "blockedbyclient"),
  continue: async () => {
    throw new Error("blocked ChatGPT request must not continue");
  }
});
assert.equal(laterPageClosed, true);

console.log("GPT Plus browser quarantine regression test passed.");
