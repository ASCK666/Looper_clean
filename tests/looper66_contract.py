#!/usr/bin/env python3
"""Lock the approved Looper66 v2 visual and interaction contract."""

from pathlib import Path
import re

from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text(encoding='utf-8')
CSS=(ROOT/'css/base.css').read_text(encoding='utf-8')
LOOPER=(ROOT/'js/looper.js').read_text(encoding='utf-8')
EVENTS=(ROOT/'js/events.js').read_text(encoding='utf-8')

controls=['playBeat','stopBeat','prevBeat','nextBeat','importFolderBtn','importBeatsBtn','autoLooperToggle','deckPitch','deckAutoToggle']
for control in controls:
    assert re.search(rf'<(?:button|input)\b[^>]*\bid="{control}"',HTML),control

assert 'class="looper66Skin"' in HTML
assert 'looper66-desktop-v2.webp' in HTML
assert 'looper66-mobile-v2.webp' in HTML
assert '>LOAD LIBRARY<' in HTML and '>LOAD BEAT<' in HTML
assert re.search(r'id="autoLooperToggle"[\s\S]*?<strong>SPEED RATE</strong>',HTML)
assert not re.search(r'id="autoLooperToggle"[^>]*>[\s\S]*?\+\d',HTML)

crate=HTML[HTML.index('<section class="panel beatCratePanel">'):]
assert crate.index('id="prevBeat"') < crate.index('id="nextBeat"')

ordered=['cassetteReelLeft','cassetteReelRight','cassetteShell','cassetteBeatName','cassetteCssLight','cassetteGlass']
positions=[HTML.index(token) for token in ordered]
assert positions==sorted(positions),positions
assert HTML.count('looper66-cassette-reel-v2.webp')==2
for forbidden in ('BEAT TAPE','LOOP RAMP','FUNK BREAK'):
    assert forbidden not in HTML.upper()

for level in range(1,6):
    assert f'[data-speed-level="{level}"]' in CSS
assert 'looperSpeedRateLevel=(looperSpeedRateLevel+1)%6' in LOOPER
assert 'autoLooperSpeedPercent+looperSpeedRateLevel' in LOOPER
assert 'const AUTO_LOOP_BATCH=8' in LOOPER
assert 'Math.max(-8,Math.min(8' in LOOPER
assert 'looperSpeedRateLevel=0' in LOOPER and 'looperPitchPercent=0' in LOOPER
assert 'const RACK_SLOTS_PER_COLUMN=3' in LOOPER
assert 'animation-play-state:paused' in CSS
assert '.cassetteDeck.playing .cassetteReel { animation-play-state:running; }' in CSS
assert '@keyframes looper66ReelSpin' in CSS
assert '@media (prefers-reduced-motion:reduce)' in CSS
assert 'grid-template-columns:repeat(3,1fr)' in CSS
assert '@media (max-width:680px)' in CSS
assert '--light-strength' in CSS and 'var(--deck-amber)' in CSS

retired=('deckFaceplate','crateFaceplate','tapeCounter','cassetteDoorEject','cassetteCavity','cassetteTapePath','cassetteSupport')
for name in retired:
    assert name not in HTML+CSS+LOOPER+EVENTS,name

assets={
    'looper66-desktop-v2.webp':(1536,1024,False),
    'looper66-mobile-v2.webp':(941,1672,False),
    'looper66-cassette-shell-v2.webp':(1000,600,True),
    'looper66-cassette-reel-v2.webp':(900,900,True),
}
for name,(min_width,min_height,needs_alpha) in assets.items():
    path=ROOT/'assets/looper-ui'/name
    assert path.is_file(),name
    image=Image.open(path).convert('RGBA')
    assert image.width>=min_width and image.height>=min_height,(name,image.size)
    assert len(image.getcolors(maxcolors=256) or [])<=64,f'{name} is not palette-bounded pixel art'
    if needs_alpha:
        alpha=image.getchannel('A')
        assert alpha.getextrema()[0]==0,f'{name} has no transparent pixels'

print('OK: Looper66 v2 uses responsive production skins, native controls, separate animated reels and CSS-only state lights')
