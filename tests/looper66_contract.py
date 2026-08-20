#!/usr/bin/env python3
"""Lock the approved Looper66 visual/interaction contract without browser timing."""

from pathlib import Path
import re

from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text(encoding='utf-8')
CSS=(ROOT/'css/base.css').read_text(encoding='utf-8')
LOOPER=(ROOT/'js/looper.js').read_text(encoding='utf-8')
BOOT=(ROOT/'js/bootstrap.js').read_text(encoding='utf-8')

controls=['playBeat','stopBeat','prevBeat','nextBeat','importFolderBtn','importBeatsBtn','autoLooperToggle','deckPitch','deckAutoToggle']
for control in controls:
    assert re.search(rf'<(?:button|input)\b[^>]*\bid="{control}"',HTML),control

assert '<div class="looper66Wordmark" aria-label="Looper66"><span>LOOPER</span><b>66</b></div>' in HTML
assert re.search(r'\.looper66Wordmark b\s*\{[^}]*color:inherit;[^}]*font-size:1em;',CSS)
assert '>LOAD LIBRARY<' in HTML and '>LOAD BEAT<' in HTML
assert re.search(r'id="autoLooperToggle"[\s\S]*?<strong>SPEED RATE</strong>',HTML)
assert not re.search(r'id="autoLooperToggle"[^>]*>[\s\S]*?\+\d',HTML)

crate=HTML[HTML.index('<section class="panel beatCratePanel">'):]
assert crate.index('id="prevBeat"') < crate.index('id="nextBeat"')

ordered=[
    'cassetteCavity','cassetteTapePath','cassetteReelLeft','cassetteShell',
    'cassetteLabel','cassetteBeatName','cassetteCssLight','cassetteSupport','cassetteGlass'
]
positions=[HTML.index(token) for token in ordered]
assert positions==sorted(positions),positions
assert '<span>SIDE A</span>' in HTML
for forbidden in ('BEAT TAPE','LOOP RAMP','FUNK BREAK'):
    assert forbidden not in HTML.upper()

for level in range(1,6):
    assert f'[data-speed-level="{level}"]' in CSS
assert 'looperSpeedRateLevel=(looperSpeedRateLevel+1)%6' in LOOPER
assert 'autoLooperSpeedPercent+looperSpeedRateLevel' in LOOPER
assert 'const AUTO_LOOP_BATCH=8' in LOOPER
assert 'Math.max(-8,Math.min(8' in LOOPER
assert 'looperSpeedRateLevel=0' in LOOPER and 'looperPitchPercent=0' in LOOPER
assert 'animation-play-state:paused' in CSS
assert '.cassetteDeck.playing .cassetteReel { animation-play-state:running; }' in CSS
assert '@media (prefers-reduced-motion:reduce)' in CSS
assert 'grid-template-columns:repeat(3,108px)' in CSS and 'width:108px' in CSS and 'height:72px' in CSS
assert '@media (max-width:680px)' in CSS

for retired in ('overlay.css','cassette-runtime.staged','looper-faceplate','LOOPER_DIRECT_CONTROL_IDS'):
    assert retired not in HTML+CSS+LOOPER+BOOT,retired

asset_names=[
    'cassette-cavity-off.png','cassette-tape-path-off.png','cassette-shell-off.png',
    'cassette-support-off.png','cassette-glass-off.png',
    'cassette-reel-left-off.png','cassette-reel-right-off.png'
]
for name in asset_names:
    path=ROOT/'assets/looper-ui'/name
    assert path.is_file(),name
    image=Image.open(path).convert('RGBA')
    pixels=image.get_flattened_data() if hasattr(image,'get_flattened_data') else image.getdata()
    opaque=[pixel for pixel in pixels if pixel[3]]
    assert opaque and all(r==g==b for r,g,b,_ in opaque),f'{name} contains baked color'

print('OK: Looper66 contract — native controls, responsive equal transport, neutral layers, CSS lights and 0–5 Speed Rate')
