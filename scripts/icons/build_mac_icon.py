"""Resize the original logo for macOS; never redraw or replace its artwork.

Source: internal/appicon/assets/source_tray_icon.png (shared brand artwork).
Outputs: icon_mac.png (1024px Dock/application icon and ICNS source),
         tray_mac.png (32px menu bar image for the 16pt Retina slot).
Windows and web assets are not modified.

Usage: python scripts/icons/build_mac_icon.py [--preview DIR]
Requires Pillow.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "internal" / "appicon" / "assets"
SOURCE = ASSETS / "source_tray_icon.png"
MAC_ICON = ASSETS / "icon_mac.png"
MAC_TRAY = ASSETS / "tray_mac.png"
MAC_SIDE = 1024
MAC_TRAY_SIDE = 32


def render(side: int) -> Image.Image:
    """Preserve the complete source image, aspect ratio, colors and alpha."""
    with Image.open(SOURCE) as source:
        artwork = source.convert("RGBA")
    artwork.thumbnail((side, side), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    # No mask: preserve alpha instead of applying it a second time.
    canvas.paste(artwork, ((side - artwork.width) // 2, (side - artwork.height) // 2))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", type=Path, default=None)
    args = parser.parse_args()
    for path, side in ((MAC_ICON, MAC_SIDE), (MAC_TRAY, MAC_TRAY_SIDE)):
        image = render(side)
        image.save(path, "PNG")
        print(f"{path.relative_to(ROOT)}: {side}px from {SOURCE.relative_to(ROOT)}")
        if args.preview:
            args.preview.mkdir(parents=True, exist_ok=True)
            image.save(args.preview / path.name, "PNG")


if __name__ == "__main__":
    main()
