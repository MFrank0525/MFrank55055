#!/usr/bin/env python3
import json
import re
import subprocess
import sys
from typing import Any, Dict, List


def extract_json(text: str) -> Any:
    text = text.strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    matches = list(re.finditer(r"(\{[\s\S]*\}|\[[\s\S]*\])", text))
    for match in reversed(matches):
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
    return {"raw": text}


def normalize_payload(payload: Any) -> Dict[str, Any]:
    if isinstance(payload, dict):
        data = payload.get("data", payload)
        gen_status = str(data.get("gen_status", payload.get("gen_status", ""))).lower() if isinstance(data, dict) else ""
        submit_id = ""
        if isinstance(data, dict):
            submit_id = str(data.get("submit_id", data.get("submitId", ""))).strip()
        if not submit_id:
            submit_id = str(payload.get("submit_id", payload.get("submitId", ""))).strip()
        return {
            "ok": gen_status != "fail",
            "data": data,
            "submit_id": submit_id,
            "raw": payload
        }
    return {"ok": True, "data": payload, "raw": payload}


def run_dreamina(dreamina_bin: str, args: List[str]) -> Dict[str, Any]:
    completed = subprocess.run(
        [dreamina_bin, *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    combined = "\n".join(item for item in [completed.stdout, completed.stderr] if item).strip()
    payload = normalize_payload(extract_json(combined))
    payload["returncode"] = completed.returncode
    payload["stdout"] = completed.stdout
    payload["stderr"] = completed.stderr
    if completed.returncode != 0:
        payload["ok"] = False
        payload["error"] = combined or f"dreamina exited with code {completed.returncode}"
    return payload


def print_payload(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    sys.exit(0 if payload.get("ok") else 1)
