import argparse
import json
from pathlib import Path

from PIL import Image, ImageOps


def normalize_reference(input_file: str, output_file: str, max_side: int, max_bytes: int) -> dict:
    with Image.open(input_file) as source:
        source.load()
        original_width, original_height = source.size
        image = ImageOps.exif_transpose(source).convert("RGB")
        scale = min(1.0, max_side / max(image.size))
        if scale < 1.0:
            image = image.resize(
                (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                Image.Resampling.LANCZOS,
            )

        output_path = Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        quality = 92
        while True:
            image.save(output_path, format="JPEG", quality=quality, optimize=True, progressive=True)
            output_bytes = output_path.stat().st_size
            if output_bytes <= max_bytes:
                break
            if quality > 70:
                quality -= 5
                continue
            next_width = max(512, round(image.width * 0.85))
            next_height = max(512, round(image.height * 0.85))
            if (next_width, next_height) == image.size:
                raise ValueError("cannot normalize reference image below byte ceiling")
            image = image.resize((next_width, next_height), Image.Resampling.LANCZOS)
            quality = 88

        return {
            "ok": True,
            "sourceBytes": Path(input_file).stat().st_size,
            "sourceWidth": original_width,
            "sourceHeight": original_height,
            "outputBytes": output_bytes,
            "outputWidth": image.width,
            "outputHeight": image.height,
            "quality": quality,
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-side", required=True, type=int)
    parser.add_argument("--max-bytes", required=True, type=int)
    args = parser.parse_args()
    if args.max_side <= 0 or args.max_bytes <= 0:
        raise ValueError("normalization limits must be positive")
    print(json.dumps(normalize_reference(args.input, args.output, args.max_side, args.max_bytes), ensure_ascii=False))


if __name__ == "__main__":
    main()
