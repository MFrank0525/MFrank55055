import argparse
import json

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()

    with Image.open(args.input) as image:
        image.load()
        width, height = image.size
        image_format = (image.format or "").upper()

    if image_format not in {"PNG", "JPEG", "WEBP"}:
        raise ValueError(f"unsupported decoded image format: {image_format or '<unknown>'}")
    if width <= 0 or height <= 0:
        raise ValueError(f"invalid decoded image dimensions: {width}x{height}")
    print(json.dumps({"format": image_format, "width": width, "height": height}))


if __name__ == "__main__":
    main()
