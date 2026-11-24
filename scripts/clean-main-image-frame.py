from pathlib import Path

from PIL import Image


SOURCE = Path("assets/auto-listing/default-main-image-frame.png")
TARGET = Path("assets/auto-listing/default-main-image-frame-v2.png")


def main() -> None:
    image = Image.open(SOURCE).convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue
            # Remove the accidental red underline/trailing shadow beneath the
            # brand banner while preserving the original logo and wordmark.
            if 10 <= x < 790 and 96 <= y < 790:
                pixels[x, y] = (red, green, blue, 0)
            elif 440 <= x < 790 and 10 <= y < 96 and red + green + blue < 220:
                pixels[x, y] = (red, green, blue, 0)
    image.save(TARGET, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
