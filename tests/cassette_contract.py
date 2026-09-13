"""Cassette contract for the approved 120927 three-asset deck."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'index.html').read_text(encoding='utf-8')
css=(ROOT/'css/looper.css').read_text(encoding='utf-8')
assets=ROOT/'assets/looper-ui/120927'

assert 'reader-mechanism.webp' in html
assert html.count('reel-animation.svg') == 2
assert 'cassette.webp' in html
assert 'id="cassetteBeatName"' in html

reader=Image.open(assets/'reader-mechanism.webp').convert('RGBA')
cassette=Image.open(assets/'cassette.webp').convert('RGBA')
assert reader.size == (550,366)
assert cassette.size == (435,262)
assert reader.getpixel((275,190))[3] == 0
assert cassette.getpixel((117,112))[3] == 0
assert cassette.getpixel((300,112))[3] == 0

reel=ET.parse(assets/'reel-animation.svg').getroot()
assert reel.attrib['viewBox'] == '0 0 64 64'
assert not list(reel.iter('{http://www.w3.org/2000/svg}mask'))
assert 'aspect-ratio:435/262' in css
for selector,level in (('.cassetteReel',1),('.cassetteTape',2)):
    assert re.search(rf'{re.escape(selector)}\s*\{{[^}}]*z-index\s*:\s*{level}(?:\s*;|\s*\}})',css,re.S)
assert 'animation-play-state:paused' in css
assert re.search(r'\.cassetteDeck\.playing\s+\.cassetteReel\s*\{[^}]*animation-play-state\s*:\s*running',css,re.S)
assert 'cassetteGlass' not in html+css
print('OK: reader, cassette and opaque animated reels have separate ownership')
