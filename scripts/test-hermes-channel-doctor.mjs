import assert from "node:assert/strict";
import test from "node:test";

import { evaluateChannelHealth } from "./hermes-channel-doctor.mjs";

test("rejects a websocket gateway that has no Feishu message scopes", () => {
  const result = evaluateChannelHealth({
    scopes: [],
    gatewayLog: "[Feishu] Connected in websocket mode (feishu)",
    connectionMode: "websocket",
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /im:message/);
});

test("accepts the required scopes and a currently connected gateway", () => {
  const result = evaluateChannelHealth({
    scopes: ["im:message", "im:message.group_at_msg:readonly"],
    gatewayLog: "[Feishu] Disconnected\n[Feishu] Connected in websocket mode (feishu)",
    connectionMode: "websocket",
  });

  assert.equal(result.ok, true);
});

test("live mode requires proof of at least one inbound event", () => {
  const result = evaluateChannelHealth({
    scopes: ["im:message", "im:message.group_at_msg:readonly"],
    gatewayLog: "[Feishu] Connected in websocket mode (feishu)",
    connectionMode: "websocket",
    requireInbound: true,
    inboundState: { message_ids: {} },
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /入站消息/);
});
