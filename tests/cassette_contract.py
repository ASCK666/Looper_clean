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
assert 'cassette-cavity.svg' in css
assert re.search(r'\.cassetteMechanism::before\s*\{[^}]*z-index\s*:\s*0[^}]*inset\s*:\s*0',css,re.S)
assert '.cassetteMechanism::after{' not in css
assert 'Clean foreground replacement for the baked brown window' not in css

tape=re.search(r'\.cassetteTape\s*\{([^}]*)\}',css,re.S)
assert tape,tape
tape_css=tape.group(1)
assert 'z-index:2' in tape_css
assert '-webkit-mask:' in tape_css
assert 'mask:' in tape_css
for edge in ('32.35%','43.22%','35.40%','24.43%','37.47%'):
    assert edge in tape_css,edge

assert '.cassetteReelLeft{left:20.46%;top:32.06%}' in css
assert '.cassetteReelRight{left:62.53%;top:32.06%;animation-duration:var(--takeup-reel-cycle)}' in css
assert 'animation:looperReelSpin var(--supply-reel-cycle) linear infinite' in css
assert 'animation-play-state:paused' in css
assert re.search(r'\.cassetteDeck\.playing\s+\.cassetteReel\s*\{[^}]*animation-play-state\s*:\s*running',css,re.S)
assert 'cassetteGlass' not in html+css
print('OK: central baked glass is masked, no foreground pseudo-glass remains, reels and cavity ownership stay explicit')
