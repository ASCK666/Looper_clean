"""Cassette contract for the approved 120927 three-asset deck."""
from pathlib import Path
import re
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'index.html').read_text(encoding='utf-8')
css=(ROOT/'css/looper.css').read_text(encoding='utf-8')
assets=ROOT/'assets/looper-ui/120927'

assert 'reader-mechanism.webp' in html
assert html.count('reel-animation.webp') == 2
assert 'cassette.webp' in html
assert 'id="cassetteBeatName"' in html

reader=Image.open(assets/'reader-mechanism.webp').convert('RGBA')
cassette=Image.open(assets/'cassette.webp').convert('RGBA')
assert reader.size == (550,366)
assert cassette.size == (435,262)
assert reader.getpixel((275,190))[3] == 0
assert cassette.getpixel((117,112))[3] == 0
assert cassette.getpixel((300,112))[3] == 0

reel=Image.open(assets/'reel-animation.webp').convert('RGBA')
assert reel.size == (66,66)
assert reel.getpixel((0,0))[3] == 0
assert reel.getpixel((33,33))[3] == 255
assert 'aspect-ratio:435/262' in css
for selector,level in (('.cassetteReel',1),('.cassetteTape',2)):
    assert re.search(rf'{re.escape(selector)}\s*\{{[^}}]*z-index\s*:\s*{level}(?:\s*;|\s*\}})',css,re.S)
assert 'animation-play-state:paused' in css
assert re.search(r'\.cassetteDeck\.playing\s+\.cassetteReel\s*\{[^}]*animation-play-state\s*:\s*running',css,re.S)
assert 'cassetteGlass' not in html+css
print('OK: reader, cassette and opaque animated reels have separate ownership')
