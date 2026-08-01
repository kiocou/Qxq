from __future__ import annotations

import argparse
import io
import shutil
import struct
from pathlib import Path

from PIL import Image


ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
ALPHA_CUTOFF = 4
TRAY_NAMES = (
    "snow-shot-tray-default.png",
    "snow-shot-tray-dark.png",
    "snow-shot-tray-light.png",
    "snow-shot-tray-snow-default.png",
    "snow-shot-tray-snow-dark.png",
    "snow-shot-tray-snow-light.png",
)


def clean_transparent_pixels(source: Image.Image) -> Image.Image:
    image = source.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha <= ALPHA_CUTOFF:
                pixels[x, y] = (0, 0, 0, 0)
    return image


def render_png(source: Image.Image, size: int) -> bytes:
    image = clean_transparent_pixels(
        source.resize((size, size), Image.Resampling.LANCZOS)
    )
    buffer = io.BytesIO()
    image.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def write_multiframe_ico(source: Image.Image, target: Path) -> None:
    frames = [(size, render_png(source, size)) for size in ICO_SIZES]
    directory_size = 6 + 16 * len(frames)
    offset = directory_size

    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as output:
        output.write(struct.pack("<HHH", 0, 1, len(frames)))
        for size, frame in frames:
            dimension = 0 if size == 256 else size
            output.write(
                struct.pack(
                    "<BBBBHHII",
                    dimension,
                    dimension,
                    0,
                    0,
                    1,
                    32,
                    len(frame),
                    offset,
                )
            )
            offset += len(frame)
        for _, frame in frames:
            output.write(frame)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).parents[1])
    args = parser.parse_args()
    root = args.root.resolve()
    master_path = root / "app-icon.png"
    icons_dir = root / "src-tauri" / "icons"
    tray_dir = root / "src-tauri" / "app-icons"

    with Image.open(master_path) as input_image:
        master = input_image.convert("RGBA")
        if master.size != (1024, 1024):
            raise ValueError(f"expected a 1024x1024 master, got {master.size}")
        write_multiframe_ico(master, icons_dir / "icon.ico")
        write_multiframe_ico(master, root / "public" / "favicon.ico")
        tray_icon = render_png(master, 64)

    for png_path in icons_dir.rglob("*.png"):
        with Image.open(png_path) as input_image:
            cleaned = clean_transparent_pixels(input_image)
        cleaned.save(png_path, "PNG", optimize=True)

    tray_dir.mkdir(parents=True, exist_ok=True)
    for name in TRAY_NAMES:
        (tray_dir / name).write_bytes(tray_icon)

    shutil.copyfile(master_path, root / "public" / "images" / "app-icon.png")
    shutil.copyfile(master_path, root / "docs" / "imgs" / "app-icon.png")


if __name__ == "__main__":
    main()
