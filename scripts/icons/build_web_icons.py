"""Generate web-only icons; preserve the existing high-resolution web artwork.

Run with Python + Pillow. Does not modify native platform assets or icon.png.
128px covers the 38px brand mark through 3x DPR. The browser fallback needs
only 16/32/48px frames, not the Windows shell's extensive DPI frame set.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "web" / "public"


def generate(output: Path = PUBLIC) -> None:
    with Image.open(PUBLIC / "icon.png") as source:
        artwork = source.convert("RGBA")
    output.mkdir(parents=True, exist_ok=True)
    artwork.resize((128, 128), Image.Resampling.LANCZOS).save(
        output / "icon-small.png", optimize=True
    )
    artwork.save(output / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])


if __name__ == "__main__":
    generate()
