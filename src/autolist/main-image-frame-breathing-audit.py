from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from PIL import Image, ImageFilter


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--frame", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    image = Image.open(args.input).convert("RGB")
    frame = Image.open(args.frame).convert("RGBA")
    if image.size != frame.size:
        raise ValueError(f"Breathing audit image/frame size mismatch: {image.size} != {frame.size}")

    width, height = image.size
    crop_width = round(width * 0.68)
    crop_height = round(height * 0.13)
    audit = image.crop((0, 0, crop_width, crop_height))
    legal_frame_mask = frame.getchannel("A").crop((0, 0, crop_width, crop_height))
    legal_frame_mask = legal_frame_mask.filter(ImageFilter.MaxFilter(9))
    legal_frame_mask = legal_frame_mask.point(lambda value: 255 if value > 0 else 0)
    audit.paste(Image.new("RGB", audit.size, (127, 127, 127)), (0, 0), legal_frame_mask)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    audit.save(temporary, format="PNG")
    os.replace(temporary, output)
    print(json.dumps({
        "ok": True,
        "width": crop_width,
        "height": crop_height,
        "maskedFrame": True,
    }))


if __name__ == "__main__":
    main()
