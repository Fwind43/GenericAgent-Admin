"""Regression checks for the macOS-only icon generator.

Run: python -m unittest discover -s scripts/icons -p 'test_*.py'
"""
import unittest

from PIL import Image

import build_mac_icon as icon


class MacIconTests(unittest.TestCase):
    def test_star_boundary_has_no_crossing_edges(self):
        points = icon.star_points(0, 0, 1, icon.SPARKLE_WAIST)
        self.assertEqual(len(points), 8)

        def cross(a, b, c):
            return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

        for i in range(len(points)):
            for j in range(i + 1, len(points)):
                if j == i + 1 or (i == 0 and j == len(points) - 1):
                    continue
                a, b = points[i], points[(i + 1) % len(points)]
                c, d = points[j], points[(j + 1) % len(points)]
                intersects = cross(a, b, c) * cross(a, b, d) < 0 and cross(c, d, a) * cross(c, d, b) < 0
                self.assertFalse(intersects, f"Star edges {i} and {j} cross")

    def test_star_alternates_outer_tips_and_inner_waists(self):
        w = icon.SPARKLE_WAIST
        self.assertEqual(icon.star_points(0, 0, 1, w), [
            (0, -1), (w, -w), (1, 0), (w, w),
            (0, 1), (-w, w), (-1, 0), (-w, -w),
        ])

    def test_render_has_four_arms_and_clear_diagonal_gaps(self):
        image = icon.draw(128, "star")
        for point in [(64, 32), (96, 64), (64, 96), (32, 64), (64, 64)]:
            self.assertEqual(image.getpixel(point), icon.BLUE, point)
        for point in [(44, 44), (84, 44), (84, 84), (44, 84)]:
            self.assertEqual(image.getpixel(point), icon.CARD, point)

    def test_committed_assets_match_generator(self):
        generated = icon.draw(icon.MAC_SIDE, "star")
        for path, expected in [
            (icon.MAC_ICON, generated),
            (icon.MAC_TRAY, generated.resize((icon.MAC_TRAY_SIDE, icon.MAC_TRAY_SIDE), Image.LANCZOS)),
        ]:
            with Image.open(path) as actual:
                self.assertEqual(actual.mode, "RGBA")
                self.assertEqual(actual.size, expected.size)
                self.assertEqual(actual.tobytes(), expected.tobytes())


if __name__ == "__main__":
    unittest.main()
