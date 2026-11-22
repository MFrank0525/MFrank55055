import argparse
import json
import statistics
from pathlib import Path

from PIL import Image, ImageStat

GATE_VERSION = "cross-axis-multi-panel-v1"


def axis_candidate(image, axis):
    pixels = image.load()
    width, height = image.size
    length = width if axis == "vertical" else height
    span = height if axis == "vertical" else width
    start = max(1, int(length * 0.40))
    end = min(length - 1, int(length * 0.60))
    candidates = []
    for position in range(start, end + 1):
        line = [pixels[position, index] if axis == "vertical" else pixels[index, position] for index in range(span)]
        previous = [pixels[position - 1, index] if axis == "vertical" else pixels[index, position - 1] for index in range(span)]
        luminance = [sum(value) / 3 for value in line]
        differences = [
            sum(abs(line[index][channel] - previous[index][channel]) for channel in range(3)) / 3
            for index in range(span)
        ]
        neighbours = []
        for offset in (-8, -7, -6, -5, 5, 6, 7, 8):
            neighbour_position = position + offset
            if neighbour_position < 0 or neighbour_position >= length:
                continue
            values = [
                pixels[neighbour_position, index] if axis == "vertical" else pixels[index, neighbour_position]
                for index in range(span)
            ]
            neighbours.extend(sum(value) / 3 for value in values)
        edge_ratio = sum(value > 35 for value in differences) / max(1, span)
        edge_mean = statistics.mean(differences)
        bright_ratio = sum(value > 242 for value in luminance) / max(1, span)
        bright_gain = statistics.mean(luminance) - statistics.mean(neighbours)
        line_stddev = statistics.pstdev(luminance)
        # A real grid divider spans most of the canvas. Product silhouettes,
        # title cards and step modules often create strong edges across only
        # part of a legitimate single poster, so partial cross-axis edges must
        # not be treated as panel separators.
        continuous_divider = edge_ratio >= 0.70 and edge_mean >= 35
        bright_gutter = bright_ratio >= 0.70 and bright_gain >= 14 and line_stddev <= 35
        score = max(
            (edge_ratio / 0.38) + (edge_mean / 28),
            (bright_ratio / 0.70) + (bright_gain / 14) if line_stddev <= 35 else 0,
        )
        candidates.append({
            "axis": axis,
            "position": position,
            "ratio": position / length,
            "edgeRatio": round(edge_ratio, 4),
            "edgeMean": round(edge_mean, 4),
            "brightRatio": round(bright_ratio, 4),
            "brightGain": round(bright_gain, 4),
            "lineStddev": round(line_stddev, 4),
            "strong": continuous_divider or bright_gutter,
            "score": round(score, 4),
        })
    return max(candidates, key=lambda item: (item["strong"], item["score"]))


def quadrant_stddevs(image, vertical_position, horizontal_position):
    width, height = image.size
    gap = 4
    boxes = [
        (0, 0, max(1, vertical_position - gap), max(1, horizontal_position - gap)),
        (min(width - 1, vertical_position + gap), 0, width, max(1, horizontal_position - gap)),
        (0, min(height - 1, horizontal_position + gap), max(1, vertical_position - gap), height),
        (min(width - 1, vertical_position + gap), min(height - 1, horizontal_position + gap), width, height),
    ]
    return [round(ImageStat.Stat(image.crop(box).convert("L")).stddev[0], 4) for box in boxes]


def inspect(image_file):
    with Image.open(image_file) as source:
        source.load()
        image = source.convert("RGB").resize((256, 256), Image.Resampling.LANCZOS)
    vertical = axis_candidate(image, "vertical")
    horizontal = axis_candidate(image, "horizontal")
    quadrants = quadrant_stddevs(image, vertical["position"], horizontal["position"])
    textured_quadrants = sum(value >= 12 for value in quadrants)
    collage_detected = bool(vertical["strong"] and horizontal["strong"] and textured_quadrants >= 3)
    return {
        "ok": True,
        "gateVersion": GATE_VERSION,
        "collageDetected": collage_detected,
        "reason": "cross_axis_multi_panel_layout" if collage_detected else "single_canvas_not_rejected",
        "analysisSize": {"width": 256, "height": 256},
        "vertical": vertical,
        "horizontal": horizontal,
        "quadrantStddevs": quadrants,
        "texturedQuadrants": textured_quadrants,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    image_file = Path(args.input).resolve()
    if not image_file.is_file():
        raise FileNotFoundError(f"main image not found: {image_file}")
    print(json.dumps(inspect(image_file), ensure_ascii=False))


if __name__ == "__main__":
    main()
