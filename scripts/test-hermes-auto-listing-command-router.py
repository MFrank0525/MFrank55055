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


class Platform(Enum):
    FEISHU = "feishu"


@dataclass
class Source:
    platform: Platform = Platform.FEISHU
    chat_id: str = "test-chat"
    thread_id: str | None = "test-thread"


@dataclass
class Event:
    text: str
    source: Source
    message_id: str = "test-message"


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
    event = Event(text="开始上架", source=Source())
    results = invoke_hook(
        "pre_gateway_dispatch",
        event=event,
        gateway=gateway,
        session_store=None,
    )
    assert {"action": "skip", "reason": "auto-listing-control-handled"} in results, (
        "The natural-language control must be fully handled by the plugin. "
        "A rewrite still enters the synchronous gateway command handler and "
        f"keeps Hermes in its visible thinking state. results={results!r}"
    )
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert gateway.actions == ["start"]
    assert gateway.adapter.messages
    first = gateway.adapter.messages[0]
    assert "已接收" in str(first["content"])
    assert first["reply_to"] == event.message_id


asyncio.run(verify_start_is_handled_without_gateway_or_llm_dispatch())
print("Hermes auto-listing command router integration test passed.")
