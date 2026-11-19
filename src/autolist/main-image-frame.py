from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


LAYOUT_VERSION = "full-bleed-layout-guide-v2"
CONTENT_RECT = (0, 0, 800, 800)


def resized_source(input_file: Path, frame: Image.Image) -> Image.Image:
    image = Image.open(input_file).convert("RGBA")
    if image.size != frame.size:
        image = image.resize(frame.size, Image.Resampling.LANCZOS)
    return image


def prepare_layout_reference(input_file: Path, frame_file: Path, output_file: Path) -> None:
    frame = Image.open(frame_file).convert("RGBA")
    image = resized_source(input_file, frame)
    merged = Image.alpha_composite(image, frame)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    merged.save(output_file, format="PNG", optimize=True)


def apply_frame(input_file: Path, frame_file: Path, output_file: Path, frame_ready_output: Path | None) -> None:
    frame = Image.open(frame_file).convert("RGBA")
    image = resized_source(input_file, frame)
    if frame_ready_output is not None:
        frame_ready_output.parent.mkdir(parents=True, exist_ok=True)
        image.save(frame_ready_output, format="PNG", optimize=True)
    merged = Image.alpha_composite(image, frame)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    merged.save(output_file, format="PNG", optimize=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["apply-frame", "prepare-reference"], default="apply-frame")
    parser.add_argument("--input", required=True)
    parser.add_argument("--frame", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--frame-ready-output")
    args = parser.parse_args()
    input_file = Path(args.input).expanduser().resolve()
    frame_file = Path(args.frame).expanduser().resolve()
    output_file = Path(args.output).expanduser().resolve()
    frame_ready_output = Path(args.frame_ready_output).expanduser().resolve() if args.frame_ready_output else None
    if not input_file.exists() or not frame_file.exists():
        print(json.dumps({"ok": False, "error": "Input image or frame file was missing."}, ensure_ascii=False))
        return 1
    if args.mode == "prepare-reference":
        prepare_layout_reference(input_file, frame_file, output_file)
    else:
        apply_frame(input_file, frame_file, output_file, frame_ready_output)
    print(json.dumps({
        "ok": True,
        "output": str(output_file),
        "frameReadyOutput": str(frame_ready_output) if frame_ready_output else None,
        "mode": args.mode,
        "layoutVersion": LAYOUT_VERSION,
        "contentRect": {"x": CONTENT_RECT[0], "y": CONTENT_RECT[1], "width": CONTENT_RECT[2], "height": CONTENT_RECT[3]},
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
