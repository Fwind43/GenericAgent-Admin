"""Ensure macOS icons use the original artwork, not a drawn substitute.

Run: python -m unittest discover -s scripts/icons -p 'test_mac_icon.py'
"""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
import build_mac_icon as icon


class MacIconTests(unittest.TestCase):
    def test_original_logo_pixels_are_preserved(self):
        with Image.open(icon.SOURCE) as source:
            original = source.convert("RGBA")
        self.assertEqual(original.width, original.height)
        for side in (icon.MAC_SIDE, icon.MAC_TRAY_SIDE):
            with self.subTest(side=side):
                expected = original.resize((side, side), Image.Resampling.LANCZOS)
                self.assertEqual(icon.render(side).tobytes(), expected.tobytes())

    def test_committed_assets_match_original_logo(self):
        for path, side in ((icon.MAC_ICON, icon.MAC_SIDE), (icon.MAC_TRAY, icon.MAC_TRAY_SIDE)):
            with self.subTest(path=path), Image.open(path) as actual:
                self.assertEqual(actual.mode, "RGBA")
                self.assertEqual(actual.size, (side, side))
                self.assertEqual(actual.tobytes(), icon.render(side).tobytes())

    def test_non_square_source_keeps_aspect_ratio_and_alpha(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.png"
            Image.new("RGBA", (16, 8), (20, 80, 120, 128)).save(path)
            with patch.object(icon, "SOURCE", path):
                actual = icon.render(16)
            self.assertEqual(actual.getchannel("A").getbbox(), (0, 4, 16, 12))
            self.assertEqual(actual.getpixel((8, 8)), (20, 80, 120, 128))

    def test_missing_source_fails_instead_of_drawing_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(icon, "SOURCE", Path(directory) / "missing.png"):
                with self.assertRaises(FileNotFoundError):
                    icon.render(32)


if __name__ == "__main__":
    unittest.main()
