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
assert reader.getpixel((275,190))[3] == 255
assert cassette.getpixel((121,116))[3] == 0
assert cassette.getpixel((304,116))[3] == 0

reel=Image.open(assets/'reel-animation.webp').convert('RGBA')
assert reel.size == (64,64)
assert reel.getpixel((0,0))[3] == 0
assert reel.getpixel((32,32))[3] == 255
assert 'aspect-ratio:435/262' in css
assert '.cassetteMechanism::before,#looper .cassetteMechanism::after' in css
assert '.cassetteMechanism::before{left:20.46%}' in css
assert '.cassetteMechanism::after{left:62.53%}' in css
assert 'The reader background remains visible in the gap' in css
for selector,level in (('.cassetteReel',1),('.cassetteTape',2)):
    assert re.search(rf'{re.escape(selector)}\s*\{{[^}}]*z-index\s*:\s*{level}(?:\s*;|\s*\}})',css,re.S)
assert 'animation-play-state:paused' in css
assert re.search(r'\.cassetteDeck\.playing\s+\.cassetteReel\s*\{[^}]*animation-play-state\s*:\s*running',css,re.S)
assert 'cassetteGlass' not in html+css
print('OK: reel backings close internal alpha cuts while the reader remains visible between reels')
