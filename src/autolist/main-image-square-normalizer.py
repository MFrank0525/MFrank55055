import argparse
import json
from pathlib import Path

from PIL import Image


def pad_to_square(input_file: str, output_file: str, side: int) -> dict:
    with Image.open(input_file) as source:
        source.load()
        rgba = source.convert("RGBA")
        canvas = Image.new("RGBA", (side, side), (255, 255, 255, 255))
        offset = ((side - rgba.width) // 2, (side - rgba.height) // 2)
        canvas.alpha_composite(rgba, offset)

        output_path = Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if output_path.suffix.lower() in (".jpg", ".jpeg"):
            canvas.convert("RGB").save(output_file, quality=95)
        else:
            canvas.save(output_file)

        return {
            "ok": True,
            "sourceWidth": source.width,
            "sourceHeight": source.height,
            "outputWidth": side,
            "outputHeight": side,
            "offsetX": offset[0],
            "offsetY": offset[1],
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--side", required=True, type=int)
    args = parser.parse_args()
    if args.side <= 0:
        raise ValueError("--side must be positive")
    print(json.dumps(pad_to_square(args.input, args.output, args.side), ensure_ascii=False))


if __name__ == "__main__":
    main()
