"""Executable regression test for the live Hermes auto-listing router plugin."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
import sys
import tempfile


PROJECT_ROOT = Path(__file__).resolve().parents[1]
HERMES_SITE_PACKAGES = Path(
    "/Users/mfrank/.local/share/uv/tools/hermes-agent/lib/python3.11/site-packages"
)
sys.path.insert(0, str(HERMES_SITE_PACKAGES))

from hermes_cli.plugins import discover_plugins, get_plugin_manager, invoke_hook  # noqa: E402
from gateway.platforms.base import (  # noqa: E402
    MessageType,
    coerce_plaintext_gateway_command,
)


class Platform(Enum):
    FEISHU = "feishu"


@dataclass
class Source:
    platform: Platform = Platform.FEISHU
    chat_id: str = "test-chat"
    thread_id: str | None = "test-thread"
    chat_type: str = "dm"


@dataclass
class Event:
    text: str
    source: Source
    message_id: str = "test-message"
    message_type: MessageType = MessageType.TEXT


class FakeAdapter:
    def __init__(self) -> None:
        self.messages: list[dict[str, object]] = []

    async def send(self, chat_id: str, content: str, **kwargs: object) -> None:
        self.messages.append({"chat_id": chat_id, "content": content, **kwargs})


class FakeGateway:
    def __init__(self) -> None:
        self.adapter = FakeAdapter()
        self.adapters = {Platform.FEISHU: self.adapter}
        self.actions: list[str] = []

    @staticmethod
    def _reply_anchor_for_event(event: Event) -> str:
        return event.message_id

    @staticmethod
    def _thread_metadata_for_source(source: Source, reply_to: str) -> dict[str, str]:
        return {"thread_id": source.thread_id or "", "reply_to": reply_to}

    async def _handle_autolist_command(self, action: str, event: Event) -> str:
        self.actions.append(action)
        await asyncio.sleep(0)
        return f"finished:{action}"


async def verify_start_is_handled_without_gateway_or_llm_dispatch() -> None:
    discover_plugins(force=True)
    manager = get_plugin_manager()
    plugin = manager._plugins.get("auto-listing-command-router")
    assert plugin is not None, "auto-listing router plugin was not discovered"
    assert plugin.enabled, f"auto-listing router plugin failed to load: {plugin.error}"
    assert "pre_gateway_dispatch" in plugin.hooks_registered
    plugin.module._ORIGIN_PATH = Path(tempfile.gettempdir()) / (
        "hermes-auto-listing-router-test-origin.json"
    )

    gateway = FakeGateway()
    for index, (alias, expected_action) in enumerate(plugin.module._CONTROL_ROUTES.items()):
        event = Event(text=alias, source=Source(), message_id=f"message-{index}")
        # Match the real Feishu inbound order: adapter plaintext coercion runs
        # before GatewayRunner fires pre_gateway_dispatch.
        coerce_plaintext_gateway_command(event)
        assert event.text == alias, (
            "Hermes core must leave every auto-listing alias for the dedicated "
            f"profile plugin; alias={alias!r} preprocessed={event.text!r}"
        )
        messages_before = len(gateway.adapter.messages)
        results = invoke_hook(
            "pre_gateway_dispatch",
            event=event,
            gateway=gateway,
            session_store=None,
        )
        assert {"action": "skip", "reason": "auto-listing-control-handled"} in results, (
            "Every natural-language control must finish gateway dispatch "
            f"without an LLM turn; alias={alias!r} results={results!r}"
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert gateway.actions[-1] == expected_action
        assert len(gateway.adapter.messages) > messages_before
        reply = gateway.adapter.messages[messages_before]
        assert reply["reply_to"] == event.message_id
        if expected_action in {"start", "continue"}:
            assert "已接收" in str(reply["content"])
        else:
            assert reply["content"] == f"finished:{expected_action}"


asyncio.run(verify_start_is_handled_without_gateway_or_llm_dispatch())
print("Hermes auto-listing command router integration test passed.")
