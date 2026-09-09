#!/usr/bin/env python3
"""Lock the approved Looper66 v2 visual and interaction contract."""

from pathlib import Path
import hashlib
import re

from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text(encoding='utf-8')
CSS='\n'.join(
    (ROOT/href.split('?',1)[0].split('#',1)[0].removeprefix('./')).read_text(encoding='utf-8')
    for href in re.findall(r'<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"',HTML)
)
LOOPER=(ROOT/'js/looper.js').read_text(encoding='utf-8')
EVENTS=(ROOT/'js/events.js').read_text(encoding='utf-8')

controls=['playBeat','stopBeat','prevBeat','nextBeat','importFolderBtn','importBeatsBtn','autoLooperToggle','deckPitch','deckAutoToggle']
for control in controls:
    assert re.search(rf'<(?:button|input)\b[^>]*\bid="{control}"',HTML),control

assert 'class="looper66Skin"' in HTML
assert './css/base.css?v=looper66-tabs-210826-5' in HTML
assert './css/looper.css' in HTML
assert './css/clean-ui.css' in HTML
assert 'assets/looper-ui/looper66-desktop-pitch-clean-1e6d4f36.webp' in HTML
assert 'assets/looper-ui/looper66-mobile-pitch-clean-c034fcbb.webp' in HTML
assert '>LOAD LIBRARY<' in HTML and '>LOAD BEAT<' in HTML
assert re.search(r'id="autoLooperToggle"[^>]*aria-label="Speed Up, plus un pour cent toutes les huit boucles"',HTML)
assert '>SPEED RATE<' not in HTML and '>+1%<' not in HTML
assert re.search(r'\.mainModeTabs\s*\{[^}]*width:\s*min\(100%,1086px\)\s*!important;[^}]*max-width:\s*1086px\s*!important;[^}]*margin:\s*0 auto\s*!important;',CSS)
for retired in ('masterVolume','masterDb','masterVolumeReadout','looperVu','headerMaster','headerVu'):
    assert retired not in HTML+CSS+LOOPER+EVENTS,retired
transport=HTML[HTML.index('<div class="deckTransport"'):HTML.index('<div id="beatImportStatus"')]
assert transport.index('id="stopBeat"') < transport.index('id="playBeat"') < transport.index('id="autoLooperToggle"')
assert 'deckTransportFaceplate' not in HTML+CSS
assert 'class="deckTransportVisual"' in HTML

crate=HTML[HTML.index('<section class="panel beatCratePanel"'):]
assert crate.index('id="prevBeat"') < crate.index('id="nextBeat"')

ordered=['cassetteReelLeft','cassetteReelRight','cassetteBeatName','cassetteBayForeground','cassetteCssLight','cassetteGlass']
positions=[HTML.index(token) for token in ordered]
assert positions==sorted(positions),positions
assert HTML.count('class="cassetteReel ')==2
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
assert '@keyframes looper66EmptyPlayPulse' in CSS
assert '.cassetteDeck:not(.loaded) #playBeat::before { animation:looper66EmptyPlayPulse 6s ease-in-out infinite; }' in CSS
assert '@keyframes looper66EmptyPlayAuraPulse' in CSS
assert '.cassetteDeck:not(.loaded) #playBeat::after { animation:looper66EmptyPlayAuraPulse 6s ease-in-out infinite; }' in CSS
assert '@media (prefers-reduced-motion:reduce)' in CSS
assert 'grid-template-columns:28fr 44fr 28fr' in CSS
assert '.deckReadoutRate { position:absolute;bottom:14%;left:8%;font-size:clamp(13px,1.8vw,27px);' in CSS
assert '@media (max-width:680px)' in CSS
assert '--light-strength' in CSS and 'var(--deck-amber)' in CSS
assert '--backlight-opacity:1' in CSS
assert '--backlight-yellow:255,205,64' in CSS
assert '0 0 19px rgba(255,152,15' not in CSS
assert '.deckHotspot::before' in CSS and '.deckLoadKey::before' in CSS
assert re.search(r'\.deckHotspot::before\s*\{[^}]*border:0;',CSS)
assert re.search(r'\.deckLoadKey::before[^\{]*\{[^}]*border:0;',CSS)
assert re.search(r'\.deckAutoKey::before\s*\{[^}]*border:0;',CSS)
# Native keycaps replace baked transport labels; each layout uses the same
# accessible buttons, with CSS-only lighting and pixel-aligned vector symbols.
assert transport.count('class="deckKeySymbol"') == 2
assert transport.count('class="deckKeyLabel"') == 3
assert '>STOP<' in transport and '>PLAY<' in transport and '>SPEED UP<' in transport
assert 'shape-rendering:crispEdges' in CSS
assert '.deckHotspot:active { transform:translateY(2px); }' in CSS
assert '--transport-light-image' not in CSS
assert '#looper .deckHotspot:focus-visible' not in CSS  # no suppression of shared focus outline
assert re.search(r'@media \(max-width:680px\)[\s\S]*\.deckTransport\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\);[^}]*grid-template-rows:48fr 46fr;',CSS)
assert re.search(r'@media \(max-width:680px\)[\s\S]*#autoLooperToggle\s*\{[^}]*grid-column:1/-1;',CSS)
assert re.search(r'\.deckLoadKey::before[^\{]*\{[^}]*box-shadow:none;[^}]*filter:blur\(2px\);',CSS)
assert 'opacity:.001' not in CSS
assert 'id="deckPitchModule"' in HTML
assert 'pitchModule.style.setProperty("--pitch-x"' in LOOPER
assert 'pitchModule.style.setProperty("--pitch-y"' in LOOPER
assert 'pitchControl.setAttribute("aria-valuetext"' in LOOPER
assert 'cassetteShell' not in HTML+CSS
assert HTML.count('class="cassetteBayForeground"')==1
assert re.search(r'<img\b[^>]*class="cassetteBayForeground"[^>]*src="assets/looper-ui/looper66-cassette-bay-d7d5e6d4\.png"',HTML)
assert re.search(r'\.cassetteMechanism\s*\{[^}]*overflow:hidden;',CSS)
assert re.search(r'\.cassetteBeatName\s*\{[^}]*border:0;[^}]*background:transparent;[^}]*box-shadow:none;',CSS)
assert re.search(r'\.cassetteMechanism::after\s*\{[^}]*clip-path:polygon\(evenodd,',CSS)
assert '.cassetteGlass { position:absolute;z-index:4;' in CSS
# Glass reflections and the recess shadow cover the moving hubs, below the door.
assert re.search(r'\.cassetteGlass\s*\{[^}]*background:linear-gradient[^;]+;box-shadow:inset[^;]+;pointer-events:none;',CSS)
assert '.cassetteBayForeground { position:absolute;z-index:5;inset:0;' in CSS
# Illumination belongs inside the aperture, below the label/glass/door. A
# full-frame overlay would brighten the hinges and obscure the printed label.
light_rule = re.search(r'\.cassetteCssLight\s*\{([^}]+)\}', CSS).group(1)
assert re.search(r'z-index:\s*2;', light_rule)
assert re.search(r'inset:\s*17\.5% 10\.5% 29%;', light_rule)
assert 'clip-path:polygon(' in light_rule
assert re.search(r'opacity:\s*0;', light_rule)
assert 'animation:' not in light_rule
assert 'mix-blend-mode:screen' in light_rule
assert '.cassetteDeck.loaded .cassetteCssLight { opacity:calc(.3 * var(--backlight-opacity)); }' in CSS
assert '.cassetteDeck.playing .cassetteCssLight { opacity:calc(.86 * var(--backlight-opacity)); }' in CSS
assert re.search(r'\.cassetteBayForeground\s*\{[^}]*display:block;[^}]*width:100%;[^}]*height:100%;[^}]*object-fit:fill;',CSS)
assert 'looper66-cassette-bay-d7d5e6d4.png' not in CSS
assert 'cassetteSupportForeground' not in HTML+CSS
assert 'clip-path:circle(44%)' in CSS
assert 'transform-origin:50% 50%' in CSS
assert 'animation:looper66ReelSpin var(--supply-reel-cycle)' in CSS
assert 'animation-duration:var(--takeup-reel-cycle)' in CSS
assert 'animation-direction:reverse' not in CSS
assert re.search(r'\.deckHotspot\s*\{[^}]*background:var\(--deck-key-surface\);[^}]*box-shadow:inset',CSS)
assert re.search(r'--deck-key-surface: linear-gradient\([^;]+var\(--deck-texture\)[^;]+;',CSS)
assert 'background:var(--deck-key-surface);' in (ROOT/'css/chopper-deck-texture.css').read_text()
assert '#chopper.screen .btn.primary::before' not in CSS
assert re.search(r'\.deckReadout\s*\{[^}]*border:0;[^}]*box-shadow:none;',CSS)
assert re.search(r'\.deckPitchModule\s*\{[^}]*border:0;[^}]*box-shadow:none;',CSS)
assert '.deckPitchModule::before' not in CSS
assert '#looper #deckPitch:focus { outline:0!important;' in CSS
assert 'filter:none!important;-webkit-tap-highlight-color:transparent' in CSS
assert 'grid-template-columns:repeat(var(--rack-columns,3),calc((100% - .9%)/3))' in CSS

retired=('deckFaceplate','crateFaceplate','tapeCounter','cassetteDoorEject','cassetteCavity','cassetteTapePath')
for name in retired:
    assert name not in HTML+CSS+LOOPER+EVENTS,name

references={
    'looper66-desktop-pitch-clean-1e6d4f36.webp':((1086,1009),'1e6d4f360d7b6382a6bfeab0559aaaf505080ff6ef6e6bff7467175dd696e548'),
    'looper66-mobile-pitch-clean-c034fcbb.webp':((441,849),'c034fcbb8d60de005240f9a339af9a51d5dd25f66c6fdb81209c2d93052ef02b'),
    'looper66-crate-cassettes.webp':((560,62),'12256e2ec27d0a2976ce0a15184f578a04034c5318bbff8819deab05d0d6e3c9'),
    'looper66-cassette-bay-d7d5e6d4.png':((793,496),'d7d5e6d4d5a23a5c972bd37aaeb33bcbfa08af92acb3322658ad0669de85081b'),
}
for name,(expected_size,expected_sha) in references.items():
    path=ROOT/'assets/looper-ui'/name
    assert path.is_file(),name
    assert Image.open(path).size==expected_size,(name,Image.open(path).size)
    assert hashlib.sha256(path.read_bytes()).hexdigest()==expected_sha,name

# The foreground must remain a real cutout: opaque/checkerboard exports can
# satisfy image-load checks while hiding both independently animated reels.
with Image.open(ROOT/'assets/looper-ui/looper66-cassette-bay-d7d5e6d4.png') as bay:
    assert bay.mode == 'RGBA', 'cassette foreground must carry alpha'
    alpha = bay.getchannel('A')
    for region in ((.23,.38,.39,.63), (.59,.38,.76,.63), (.22,.18,.78,.23)):
        box = tuple(round(value * size) for value,size in zip(region,(793,496,793,496)))
        assert alpha.crop(box).getextrema()[1] == 0, ('foreground hides reel or label', box)
    for point in ((0,0),(792,0),(0,495),(792,495)):
        assert alpha.getpixel(point) == 0, ('opaque exterior', point)
    for point in ((396,40),(96,440),(690,440)):
        assert alpha.getpixel(point) >= 250, ('missing latch or lower hinge', point)

print('OK: Looper66 v2 uses responsive production skins, native controls, separate animated reels and CSS-only state lights')
