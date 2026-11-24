from __future__ import annotations

import argparse
import colorsys
import json
import math
from pathlib import Path

from PIL import Image


GATE_VERSION = "main-image-visual-diversity-v1"


def cosine(left: list[float], right: list[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def hamming(left: int, right: int) -> int:
    return bin(left ^ right).count("1")


def inspect_image(path: Path) -> dict:
    image = Image.open(path).convert("RGB")
    image.load()
    sample = image.resize((96, 96), Image.Resampling.LANCZOS)
    hue_histogram = [0.0] * 12
    warm = 0
    blue = 0
    saturated = 0
    pixels = list(sample.getdata())
    for red, green, blue_channel in pixels:
        hue, saturation, value = colorsys.rgb_to_hsv(red / 255.0, green / 255.0, blue_channel / 255.0)
        if saturation >= 0.18 and value >= 0.25:
            hue_histogram[min(11, int(hue * 12))] += saturation * value
        if 0.055 <= hue <= 0.18 and saturation >= 0.25 and value >= 0.45:
            warm += 1
        if 0.50 <= hue <= 0.70 and saturation >= 0.25 and value >= 0.35:
            blue += 1
        if saturation >= 0.45:
            saturated += 1
    hist_total = sum(hue_histogram) or 1.0
    hue_histogram = [value / hist_total for value in hue_histogram]
    gray = image.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    gray_pixels = list(gray.getdata())
    dhash = 0
    bit = 0
    for row in range(8):
        for column in range(8):
            if gray_pixels[row * 9 + column] > gray_pixels[row * 9 + column + 1]:
                dhash |= 1 << bit
            bit += 1
    count = len(pixels)
    return {
        "file": str(path),
        "width": image.width,
        "height": image.height,
        "warmRatio": warm / count,
        "blueRatio": blue / count,
        "saturatedRatio": saturated / count,
        "hueHistogram": hue_histogram,
        "dhash": f"{dhash:016x}",
        "_dhashValue": dhash,
    }


def average_signature(items: list[dict]) -> list[float]:
    if not items:
        return []
    return [
        sum(item["hueHistogram"][index] for item in items) / len(items)
        for index in range(12)
    ] + [
        sum(item["warmRatio"] for item in items) / len(items),
        sum(item["blueRatio"] for item in items) / len(items),
        sum(item["saturatedRatio"] for item in items) / len(items),
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", action="append", required=True)
    parser.add_argument("--expected", type=int, required=True)
    parser.add_argument("--images-per-round", type=int, default=4)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    paths = [Path(value).expanduser().resolve() for value in args.input]
    issues: list[dict] = []
    if len(paths) != args.expected:
        issues.append({"code": "image_count_mismatch", "expected": args.expected, "actual": len(paths)})
    missing = [str(path) for path in paths if not path.exists()]
    if missing:
        issues.append({"code": "image_missing", "files": missing})
    images = [inspect_image(path) for path in paths if path.exists()]
    non_square = [item["file"] for item in images if item["width"] != item["height"]]
    if non_square:
        issues.append({"code": "image_not_square", "files": non_square})
    duplicate_pairs = []
    for index, left in enumerate(images):
        for right in images[index + 1:]:
            distance = hamming(left["_dhashValue"], right["_dhashValue"])
            color_similarity = cosine(left["hueHistogram"], right["hueHistogram"])
            if distance == 0 and color_similarity >= 0.995:
                duplicate_pairs.append({
                    "left": left["file"],
                    "right": right["file"],
                    "distance": distance,
                    "colorSimilarity": color_similarity,
                })
    if duplicate_pairs:
        issues.append({"code": "near_duplicate_images", "pairs": duplicate_pairs[:20]})
    gold_dominant = [item["file"] for item in images if item["warmRatio"] >= 0.18]
    max_gold_dominant = math.floor(args.expected * 0.40)
    if len(gold_dominant) > max_gold_dominant:
        issues.append({
            "code": "warm_gold_overuse",
            "actual": len(gold_dominant),
            "maximum": max_gold_dominant,
            "files": gold_dominant,
        })
    rounds = [
        images[index:index + args.images_per_round]
        for index in range(0, len(images), args.images_per_round)
        if images[index:index + args.images_per_round]
    ]
    round_signatures = [average_signature(round_items) for round_items in rounds]
    near_identical_rounds = []
    for index, left in enumerate(round_signatures):
        for right_index, right in enumerate(round_signatures[index + 1:], start=index + 1):
            similarity = cosine(left, right)
            if similarity >= 0.995:
                near_identical_rounds.append({"leftRound": index + 1, "rightRound": right_index + 1, "similarity": similarity})
    if near_identical_rounds:
        issues.append({"code": "round_palette_homogeneity", "pairs": near_identical_rounds})
    public_images = [{key: value for key, value in item.items() if not key.startswith("_")} for item in images]
    report = {
        "ok": not issues,
        "gateVersion": GATE_VERSION,
        "expectedImageCount": args.expected,
        "actualImageCount": len(images),
        "imagesPerRound": args.images_per_round,
        "goldDominantCount": len(gold_dominant),
        "maxGoldDominantCount": max_gold_dominant,
        "images": public_images,
        "issues": issues,
    }
    report_path = Path(args.report).expanduser().resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
