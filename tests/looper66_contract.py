#!/usr/bin/env python3
"""Lock the approved Looper66 v2 visual and interaction contract."""

from pathlib import Path
import hashlib
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
assert 'assets/looper-ui/looper66-desktop-target.webp' in HTML
assert 'assets/looper-ui/looper66-mobile-target.webp' in HTML
assert '>LOAD LIBRARY<' in HTML and '>LOAD BEAT<' in HTML
assert re.search(r'id="autoLooperToggle"[^>]*aria-label="Speed Up, plus un pour cent toutes les huit boucles"',HTML)
assert '>SPEED RATE<' not in HTML and '>+1%<' not in HTML
transport=HTML[HTML.index('<div class="deckTransport"'):HTML.index('<div id="beatImportStatus"')]
assert transport.index('id="stopBeat"') < transport.index('id="playBeat"') < transport.index('id="autoLooperToggle"')
assert 'deckTransportFaceplate' not in HTML+CSS
assert 'class="deckTransportVisual"' in HTML

crate=HTML[HTML.index('<section class="panel beatCratePanel">'):]
assert crate.index('id="prevBeat"') < crate.index('id="nextBeat"')

ordered=['cassetteReelLeft','cassetteReelRight','cassetteBeatName','cassetteSupportForeground','cassetteCssLight','cassetteGlass']
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
assert '@media (prefers-reduced-motion:reduce)' in CSS
assert 'grid-template-columns:repeat(3,minmax(0,1fr))' in CSS
assert '@media (max-width:680px)' in CSS
assert '--light-strength' in CSS and 'var(--deck-amber)' in CSS
assert '--backlight-opacity:1' in CSS
assert '.deckHotspot::before' in CSS and '.deckLoadKey::before' in CSS
assert 'opacity:.001' not in CSS
assert 'id="deckPitchModule"' in HTML
assert 'pitchModule.style.setProperty("--pitch-x"' in LOOPER
assert 'pitchModule.style.setProperty("--pitch-y"' in LOOPER
assert 'pitchControl.setAttribute("aria-valuetext"' in LOOPER
assert 'cassetteShell' not in HTML+CSS
assert HTML.count('class="cassetteSupportForeground"')==1
assert re.search(r'\.cassetteMechanism\s*\{[^}]*overflow:hidden;',CSS)
assert '.cassetteSupportForeground { position:absolute;z-index:4;' in CSS
assert '.cassetteGlass { position:absolute;z-index:6;' in CSS
assert 'clip-path:circle(44%)' in CSS
assert 'transform-origin:50% 50%' in CSS
assert 'animation:looper66ReelSpin var(--supply-reel-cycle)' in CSS
assert 'animation-duration:var(--takeup-reel-cycle)' in CSS
assert 'animation-direction:reverse' not in CSS
assert re.search(r'\.deckHotspot\s*\{[^}]*background:transparent;[^}]*box-shadow:none;',CSS)
assert 'grid-template-columns:repeat(var(--rack-columns,3),calc((100% - .9%)/3))' in CSS

retired=('deckFaceplate','crateFaceplate','tapeCounter','cassetteDoorEject','cassetteCavity','cassetteTapePath')
for name in retired:
    assert name not in HTML+CSS+LOOPER+EVENTS,name

references={
    'looper66-desktop-target.webp':((1086,1009),'7ccc3220f58d2779992085566836809f0ae5c34af0f13ce8b3d537f14f96e240'),
    'looper66-mobile-target.webp':((441,849),'da92e13829331565e4b15c12e48c4e0f14bee796cef0e977eb3a13cb43fef144'),
    'looper66-transport.webp':((750,124),'ce7acecc81f0c112ae104d4035a334c6a3aba3b7940f9a62014b99b009fc6376'),
    'looper66-crate-cassettes.webp':((560,62),'12256e2ec27d0a2976ce0a15184f578a04034c5318bbff8819deab05d0d6e3c9'),
}
for name,(expected_size,expected_sha) in references.items():
    path=ROOT/'assets/looper-ui'/name
    assert path.is_file(),name
    assert Image.open(path).size==expected_size,(name,Image.open(path).size)
    assert hashlib.sha256(path.read_bytes()).hexdigest()==expected_sha,name

print('OK: Looper66 v2 uses responsive production skins, native controls, separate animated reels and CSS-only state lights')
