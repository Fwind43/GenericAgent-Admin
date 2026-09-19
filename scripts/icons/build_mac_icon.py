"""Build the macOS application mark (no letters, no "GA" text).

Item 5 of the v0.3.11 review asks the mac icon to stop carrying the "GA" text.
The old mark was a G/A monogram in a white rounded card, so the letters are
replaced by a graphic that keeps the existing palette and container:

    * container: white rounded card, corner radius 14.65% of the side, a very
      light rim, full bleed inside the canvas (matches the previous icon).
    * mark: a four-point blue star (the brand blue). An earlier draft paired it
      with a small dark dot; at 32px that dot read as a notification badge, so
      the shipped mark is the star alone, which stays crisp down to 16px.

This script is macOS-only on purpose. The Windows and web icons are authored by
their own pipeline (internal/appicon/assets/tray_windows.ico plus
scripts/icons/build_windows_icon.py, and the web/public/* assets), and this
script deliberately does not touch them.

Output:
    internal/appicon/assets/icon_mac.png   1024px
        - the source release-assets.yml feeds to sips/iconutil for
          Contents/Resources/AppIcon.icns, and
        - the bytes desktop_darwin.go hands to NSApp for the Dock.
    internal/appicon/assets/tray_mac.png    32px
        - the mac menu bar slot (16pt at 2x), so the mac menu bar can drop the
          "GA" title without touching the shared tray.png.

Usage:
    python scripts/icons/build_mac_icon.py [--variant star|star-dot] [--preview DIR]
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "internal" / "appicon" / "assets"
MAC_ICON = ASSETS / "icon_mac.png"
MAC_SIDE = 1024
MAC_TRAY = ASSETS / "tray_mac.png"
MAC_TRAY_SIDE = 32  # the menu bar slot is 16pt tall, i.e. 32px at 2x

CARD = (255, 255, 255, 255)
RIM = (232, 232, 235, 255)
BLUE = (14, 145, 212, 255)
DARK = (24, 24, 24, 255)
# The card the previous icon used: a plain rounded square whose corner arc is
# circular, tangent at ~14.65% of the side.
RADIUS_RATIO = 0.1465
RIM_RATIO = 0.006
STAR_RADIUS = 0.322
SPARKLE_WAIST = 0.30
DOT_RATIO = 0.075
DOT_OFFSET = 0.30


def star_points(cx: float, cy: float, radius: float, waist: float) -> list[tuple[float, float]]:
    """A four-point star: long arms up/down/left/right, concave diagonals."""
    points: list[tuple[float, float]] = []
    for x, y in ((0, -1), (1, 0), (0, 1), (-1, 0)):
        points.append((cx + x * radius, cy + y * radius))
    for dx, dy in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
        points.append((cx + dx * radius * waist, cy + dy * radius * waist))
    return points


def draw(side: int, variant: str) -> Image.Image:
    scale = 4
    canvas = side * scale
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    dr.rounded_rectangle(
        [0, 0, canvas - 1, canvas - 1],
        radius=RADIUS_RATIO * canvas,
        fill=CARD,
        outline=RIM,
        width=max(1, round(RIM_RATIO * canvas)),
    )
    centre = canvas / 2
    radius = STAR_RADIUS * canvas
    dr.polygon(star_points(centre, centre, radius, SPARKLE_WAIST), fill=BLUE)
    if variant == "star-dot":
        dot = DOT_RATIO * canvas
        dx = centre - DOT_OFFSET * canvas
        dy = centre - DOT_OFFSET * canvas
        dr.ellipse([dx - dot, dy - dot, dx + dot, dy + dot], fill=DARK)
    return img.resize((side, side), Image.LANCZOS)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--variant", choices=("star", "star-dot"), default="star")
    parser.add_argument("--preview", type=Path, default=None)
    args = parser.parse_args()

    icon = draw(MAC_SIDE, args.variant)
    icon.save(MAC_ICON)
    icon.resize((MAC_TRAY_SIDE, MAC_TRAY_SIDE), Image.LANCZOS).save(MAC_TRAY)
    print(f"{MAC_ICON.relative_to(ROOT)}: {MAC_SIDE}px variant={args.variant}")

    if args.preview:
        args.preview.mkdir(parents=True, exist_ok=True)
        icon.save(args.preview / f"mark_{args.variant}.png")


if __name__ == "__main__":
    main()
