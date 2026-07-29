"""Deterministic natural-language controls for the Douyin auto-listing project."""

from __future__ import annotations

from datetime import datetime
import json
import os
from pathlib import Path

_CONTROL_ROUTES = {
    "开始上架": "/autolist-start",
    "继续上架": "/autolist-continue",
    "恢复上架": "/autolist-continue",
    "暂停上架": "/autolist-pause",
    "停止上架": "/autolist-pause",
    "上架状态": "/autolist-status",
    "上架进度": "/autolist-status",
    "查看上架状态": "/autolist-status",
    "查看上架进度": "/autolist-status",
}

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


def _route_auto_listing_control(*, event, **_kwargs):
    text = str(getattr(event, "text", "") or "").strip().rstrip("。！!？?").strip()
    command = _CONTROL_ROUTES.get(text)
    if command:
        _capture_auto_listing_origin(event)
        return {"action": "rewrite", "text": command}
    return {"action": "allow"}


def register(ctx) -> None:
    ctx.register_hook("pre_gateway_dispatch", _route_auto_listing_control)
