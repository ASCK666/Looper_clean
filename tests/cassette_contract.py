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
assert 'cassette-door.svg' in html
assert html.count('class="cassetteDoor"') == 1
assert 'id="cassetteBeatName"' in html
assert 'cassetteReferenceOverlay' not in html+css
assert 'cassette-reference-overlay' not in html+css

reader=Image.open(assets/'reader-mechanism.webp').convert('RGBA')
cassette=Image.open(assets/'cassette.webp').convert('RGBA')
assert reader.size == (550,366)
assert cassette.size == (435,262)
assert reader.getpixel((275,190))[3] == 255
assert cassette.getpixel((121,116))[3] == 0
assert cassette.getpixel((304,116))[3] == 0
# The central window now owns a dark, textured magnetic-tape rendering.
assert max(cassette.getpixel((217,116))[:3]) < 80
assert sum(cassette.getpixel((180,116))[:3])/3 < 80
assert cassette.getpixel((180,108))[:3] != cassette.getpixel((180,128))[:3]

reel=Image.open(assets/'reel-animation.webp').convert('RGBA')
assert reel.size == (64,64)
assert reel.getpixel((0,0))[3] == 0
assert reel.getpixel((32,32))[3] == 255
# White/ivory toothed hub, dark spool face; CSS must not crush the hub back to brown.
assert sum(reel.getpixel((32,8))[:3])/3 > 200
assert max(reel.getpixel((32,32))[:3]) < 50

assert 'aspect-ratio:435/262' in css
assert 'cassette-cavity.svg' in css
before=re.search(r'\.cassetteMechanism::before\s*\{([^}]*)\}',css,re.S)
assert before,before
assert 'z-index:0' in before.group(1) and 'inset:0' in before.group(1)
assert '-webkit-mask:' in before.group(1) and 'mask:' in before.group(1)
for token in ('27.82%','69.89%','44.27%'):
    assert token in before.group(1),token
assert '.cassetteMechanism::after{' not in css
door=re.search(r'\.cassetteDoor\s*\{([^}]*)\}',css,re.S)
assert door,door
assert 'z-index:19' in door.group(1)
assert '.cassetteDeck::before{' not in css
assert 'filter:brightness(.36)' not in css
assert 'Clean foreground replacement for the baked brown window' not in css

tape=re.search(r'\.cassetteTape\s*\{([^}]*)\}',css,re.S)
assert tape,tape
tape_css=tape.group(1)
assert 'z-index:2' in tape_css
assert '-webkit-mask:' not in tape_css
assert 'mask:' not in tape_css


assert '.cassetteReelLeft{left:20.46%;top:32.06%}' in css
assert '.cassetteReelRight{left:62.53%;top:32.06%;animation-duration:var(--takeup-reel-cycle)}' in css
assert 'animation:looperReelSpin var(--supply-reel-cycle) linear infinite' in css
assert 'animation-play-state:paused' in css
assert re.search(r'\.cassetteDeck\.playing\s+\.cassetteReel\s*\{[^}]*animation-play-state\s*:\s*running',css,re.S)
assert 'cassetteGlass' not in html+css
print('OK: textured magnetic tape is baked into the cassette, white hub teeth stay native, reels animate without a darkening filter')
