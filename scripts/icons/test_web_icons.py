"""Web icon size, reference and reproducibility regressions."""
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from build_web_icons import generate, PUBLIC, ROOT


class WebIconsTest(unittest.TestCase):
    def test_generated_files_are_small_and_reproducible(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            generate(output)
            first = {p.name: p.read_bytes() for p in output.iterdir()}
            generate(output)
            for name, data in first.items():
                self.assertEqual(data, (output / name).read_bytes())
                self.assertEqual(data, (PUBLIC / name).read_bytes())
                self.assertLess(len(data), 20000)
            with Image.open(output / 'icon-small.png') as image:
                self.assertEqual(image.size, (128, 128))
                self.assertEqual(image.mode, 'RGBA')
                with Image.open(PUBLIC / 'icon.png') as source:
                    expected = source.convert('RGBA').resize((128, 128), Image.Resampling.LANCZOS)
                    self.assertEqual(image.tobytes(), expected.tobytes())
            with Image.open(output / 'favicon.ico') as image:
                self.assertEqual(image.info['sizes'], {(16, 16), (32, 32), (48, 48)})

    def test_consumers_do_not_fetch_master(self):
        for name in ['web/index.html', 'web/src/App.jsx']:
            source = (ROOT / name).read_text(encoding='utf-8')
            self.assertNotIn('"/icon.png"', source)
            self.assertIn('"/icon-small.png"', source)


if __name__ == '__main__':
    unittest.main()
