"""Independent cassette assets, one style owner and the retained state boundary."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT/'index.html').read_text()
css = (ROOT/'css/looper.css').read_text()
svg_ns = '{http://www.w3.org/2000/svg}'
expected = {'cassetteTape': 'tape', 'cassetteReel cassetteReelLeft': 'reel',
            'cassetteReel cassetteReelRight': 'reel', 'cassetteLabel': 'label',
            'cassetteBayForeground': 'frame'}
for class_name, asset in expected.items():
    tag = re.search(rf'<img\b[^>]*class="{class_name}"[^>]*>', html).group()
    assert f'src="assets/looper-ui/cassette-{asset}.svg"' in tag
    assert 'alt=""' in tag and 'aria-hidden="true"' in tag
    path = ROOT/f'assets/looper-ui/cassette-{asset}.svg'
    root = ET.parse(path).getroot()
    assert root.attrib['viewBox'] == ('0 0 128 128' if asset == 'reel' else '0 0 900 600')
    # Reels, paper and door must be original vectors, never an embedded skin crop.
    assert not list(root.iter(svg_ns+'image'))
    assert not list(root.iter(svg_ns+'text'))
    assert not list(root.iter(svg_ns+'filter'))
    for node in root.iter():
        for key, value in node.attrib.items():
            if key.endswith('href'):
                assert value.startswith('#'), (path, value)
for href in re.findall(r'<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"', html):
    path = ROOT/href.split('?')[0]
    if path.name != 'looper.css':
        assert not re.search(r'\.cassette(?:Mechanism|Tape|Reel|Label|BeatName|CssLight|BayForeground)\b', path.read_text()), path
assert 'aspect-ratio:3/2' in css
assert 'cassetteMechanism::' not in css
assert 'cassetteGlass' not in html+css
print('OK: standalone cassette vectors, decorative accessibility and one CSS owner')
