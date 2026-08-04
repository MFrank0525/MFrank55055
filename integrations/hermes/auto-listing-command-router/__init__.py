"""Deterministic natural-language controls for the Douyin auto-listing project."""

from __future__ import annotations

import asyncio
from datetime import datetime
import json
import logging
import os
from pathlib import Path

_CONTROL_ROUTES = {
    "开始上架": "start",
    "继续上架": "continue",
    "恢复上架": "continue",
    "暂停上架": "pause",
    "停止上架": "pause",
    "上架状态": "status",
    "上架进度": "status",
    "查看上架状态": "status",
    "查看上架进度": "status",
    "状态": "status",
    "进度": "status",
    "查询状态": "status",
    "查询进度": "status",
    "查看状态": "status",
    "查看进度": "status",
}
_BACKGROUND_TASKS: set[asyncio.Task] = set()
_LOGGER = logging.getLogger(__name__)

_ORIGIN_PATH = Path(
    "/Users/mfrank/MFrank55055/data/auto-listing/control/hermes-watchdog-origin.json"
)


def _capture_auto_listing_origin(event) -> None:
    source = getattr(event, "source", None)
    platform = getattr(
        getattr(source, "platform", None),
        "value",
        getattr(source, "platform", ""),
    )
    chat_id = str(getattr(source, "chat_id", "") or "")
    reply_to_message_id = str(
        getattr(event, "message_id", "")
        or getattr(event, "reply_to_message_id", "")
        or ""
    )
    if not platform or not chat_id or not reply_to_message_id:
        return
    payload = {
        "platform": str(platform),
        "chat_id": chat_id,
        "thread_id": str(getattr(source, "thread_id", "") or "") or None,
        "reply_to_message_id": reply_to_message_id,
        "captured_at": datetime.now().astimezone().isoformat(),
    }
    _ORIGIN_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = _ORIGIN_PATH.with_suffix(_ORIGIN_PATH.suffix + ".tmp")
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary_path, _ORIGIN_PATH)


async def _send_control_reply(gateway, event, content: str) -> None:
    source = getattr(event, "source", None)
    adapter = getattr(gateway, "adapters", {}).get(getattr(source, "platform", None))
    if adapter is None:
        raise RuntimeError("Hermes adapter is unavailable for auto-listing control reply")
    reply_to = gateway._reply_anchor_for_event(event)
    metadata = gateway._thread_metadata_for_source(source, reply_to)
    await adapter.send(
        getattr(source, "chat_id", ""),
        content,
        reply_to=reply_to,
        metadata=metadata,
    )


async def _handle_auto_listing_control(gateway, event, action: str) -> None:
    try:
        if action in {"start", "continue"}:
            acknowledgement = (
                "自动上架启动请求已接收，控制器正在后台处理。"
                if action == "start"
                else "自动上架继续请求已接收，控制器正在后台处理。"
            )
            await _send_control_reply(gateway, event, acknowledgement)
        result = await gateway._handle_autolist_command(action, event)
        if action in {"status", "pause"}:
            await _send_control_reply(gateway, event, result)
        elif "失败" in result and "超时" not in result:
            await _send_control_reply(gateway, event, result)
        _LOGGER.info(
            "Auto-listing control completed outside agent dispatch: action=%s result=%r",
            action,
            result,
        )
    except Exception as exc:
        _LOGGER.exception("Auto-listing control failed outside agent dispatch: action=%s", action)
        try:
            await _send_control_reply(gateway, event, f"自动上架控制命令执行失败：{exc}")
        except Exception:
            _LOGGER.exception("Failed to deliver auto-listing control failure")


def _discard_background_task(task: asyncio.Task) -> None:
    _BACKGROUND_TASKS.discard(task)
    try:
        task.result()
    except Exception:
        _LOGGER.exception("Unhandled auto-listing control task failure")


def _route_auto_listing_control(*, event, gateway, **_kwargs):
    text = str(getattr(event, "text", "") or "").strip().rstrip("。！!？?").strip()
    action = _CONTROL_ROUTES.get(text)
    if action:
        _capture_auto_listing_origin(event)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return {"action": "rewrite", "text": f"/autolist-{action}"}
        task = loop.create_task(_handle_auto_listing_control(gateway, event, action))
        _BACKGROUND_TASKS.add(task)
        task.add_done_callback(_discard_background_task)
        return {"action": "skip", "reason": "auto-listing-control-handled"}
    return {"action": "allow"}


def register(ctx) -> None:
    ctx.register_hook("pre_gateway_dispatch", _route_auto_listing_control)
