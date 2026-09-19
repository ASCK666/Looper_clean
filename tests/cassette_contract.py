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
assert 'cassette-reference-overlay.webp' in html
assert html.count('class="cassetteReferenceOverlay"') == 1
assert 'id="cassetteBeatName"' in html

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

overlay=Image.open(assets/'cassette-reference-overlay.webp').convert('RGBA')
assert overlay.size == (542,347)
# The overlay keeps continuous smoked-glass texture over both reel positions;
# it contains neither opaque frozen hubs nor fully transparent holes.
for cx in (195,374):
    samples=[overlay.getpixel((cx,183)),overlay.getpixel((cx,160)),overlay.getpixel((cx,206))]
    assert all(0<pixel[3]<96 for pixel in samples),samples
    assert len({pixel[:3] for pixel in samples})>1,samples
# The title slot is smoked glass, not the former fully transparent rectangle.
title_glass=[overlay.getpixel((x,y)) for x,y in ((190,96),(290,106),(392,118))]
assert all(128<=pixel[3]<=192 for pixel in title_glass),title_glass
assert len({pixel[:3] for pixel in title_glass})>1,title_glass

assert 'aspect-ratio:435/262' in css
assert 'cassette-cavity.svg' in css
before=re.search(r'\.cassetteMechanism::before\s*\{([^}]*)\}',css,re.S)
assert before,before
assert 'z-index:0' in before.group(1) and 'inset:0' in before.group(1)
assert '-webkit-mask:' in before.group(1) and 'mask:' in before.group(1)
for token in ('27.82%','69.89%','44.27%'):
    assert token in before.group(1),token
assert '.cassetteMechanism::after{' not in css
overlay_css=re.search(r'\.cassetteReferenceOverlay\s*\{([^}]*)\}',css,re.S)
assert overlay_css,overlay_css
assert 'z-index:19' in overlay_css.group(1)
title_css=re.search(r'\.cassetteBeatName\s*\{([^}]*)\}',css,re.S)
assert title_css,title_css
assert 'z-index:18' in title_css.group(1)
assert 'color:#111' in title_css.group(1)
assert 'text-shadow:none' in title_css.group(1)
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
