import argparse
import json
import os
import sys

from PIL import Image, ImageOps


def probe(input_file: str) -> dict:
    with Image.open(input_file) as source:
        image = ImageOps.exif_transpose(source)
        return {
            "ok": True,
            "width": image.width,
            "height": image.height,
            "format": source.format or "",
        }


def resize(input_file: str, output_file: str, width: int, height: int) -> dict:
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    with Image.open(input_file) as source:
        image = ImageOps.exif_transpose(source)
        resized = image.resize((width, height), Image.Resampling.LANCZOS)
        extension = os.path.splitext(output_file)[1].lower()
        if extension in (".jpg", ".jpeg") and resized.mode not in ("RGB", "L"):
            resized = resized.convert("RGB")
        resized.save(output_file)
    return probe(output_file)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output")
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    args = parser.parse_args()

    try:
        if args.output:
            if not args.width or not args.height or args.width <= 0 or args.height <= 0:
                raise ValueError("Resize mode requires positive --width and --height values.")
            payload = resize(args.input, args.output, args.width, args.height)
        else:
            payload = probe(args.input)
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
