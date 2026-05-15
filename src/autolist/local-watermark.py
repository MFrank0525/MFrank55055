from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]


def load_font(font_size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, font_size)
            except Exception:
                continue
    return ImageFont.load_default()


def average_brightness(image: Image.Image, box: tuple[int, int, int, int]) -> float:
    left, top, right, bottom = box
    crop_left = max(0, min(left, image.width))
    crop_top = max(0, min(top, image.height))
    crop_right = max(crop_left + 1, min(image.width, right))
    crop_bottom = max(crop_top + 1, min(image.height, bottom))
    region = image.crop((crop_left, crop_top, crop_right, crop_bottom)).convert("L")
    histogram = region.histogram()
    total = sum(histogram)
    if total <= 0:
        return 128.0
    weighted = sum(index * count for index, count in enumerate(histogram))
    return weighted / total


def compute_alpha(brightness: float) -> int:
    if brightness >= 210:
        return 34
    if brightness >= 170:
        return 30
    if brightness >= 130:
        return 24
    if brightness >= 90:
        return 20
    return 16


def tiled_positions(width: int, height: int, text_width: int, text_height: int) -> Iterable[tuple[int, int]]:
    step_x = max(int(text_width * 0.95), 180)
    step_y = max(int(text_height * 2.1), 120)
    row = 0
    y = -step_y
    while y < height + step_y:
        offset_x = 0 if row % 2 == 0 else int(step_x * 0.45)
        x = -step_x + offset_x
        while x < width + step_x:
            yield x, y
            x += step_x
        y += step_y
        row += 1


def apply_watermark(input_file: Path, output_file: Path, watermark_text: str) -> None:
    image = Image.open(input_file).convert("RGBA")
    width, height = image.size
    font_size = max(18, min(width, height) // 18)
    font = load_font(font_size)

    probe = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    probe_draw = ImageDraw.Draw(probe)
    bbox = probe_draw.textbbox((0, 0), watermark_text, font=font)
    text_width = max(1, bbox[2] - bbox[0])
    text_height = max(1, bbox[3] - bbox[1])

    text_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(text_layer)

    for x, y in tiled_positions(width, height, text_width, text_height):
        brightness = average_brightness(image, (x, y, x + text_width, y + text_height))
        alpha = compute_alpha(brightness)
        draw.text((x, y), watermark_text, font=font, fill=(255, 255, 255, alpha))

    rotated = text_layer.rotate(18, resample=Image.Resampling.BICUBIC, expand=False)
    merged = Image.alpha_composite(image, rotated)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    merged.convert("RGB").save(output_file, quality=96)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--text", required=True)
    args = parser.parse_args()

    input_file = Path(args.input).expanduser().resolve()
    output_file = Path(args.output).expanduser().resolve()

    if not input_file.exists():
        print(json.dumps({"ok": False, "error": f"Input image not found: {input_file}"}, ensure_ascii=False))
        return 1

    apply_watermark(input_file, output_file, args.text)
    print(json.dumps({"ok": True, "output": str(output_file)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
