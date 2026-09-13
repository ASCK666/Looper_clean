#!/usr/bin/env python3
"""Lock the functional contract of the approved 120927 Looper deck."""
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text(encoding='utf-8')
CSS=(ROOT/'css/looper.css').read_text(encoding='utf-8')
LOOPER=(ROOT/'js/looper.js').read_text(encoding='utf-8')
VIEW=(ROOT/'js/looper-view.js').read_text(encoding='utf-8')
EVENTS=(ROOT/'js/events.js').read_text(encoding='utf-8')

for control in ('playBeat','stopBeat','importFolderBtn','importBeatsBtn','autoLooperToggle','deckPitch','deckVolume'):
    assert re.search(rf'<(?:button|input)\b[^>]*\bid="{control}"',HTML),control
assert 'deckAutoToggle' not in HTML+EVENTS

# One clean visual source set, layered directly by the Looper stylesheet.
assert 'assets/looper-ui/120927/' in HTML
for asset in ('deck-shell.svg','rear-cables.svg','desk-wood.svg'):
    assert asset in CSS,asset
assert 'deck-scene-120927.svg' not in CSS
assert not (ROOT/'assets/looper-ui/120927/deck-scene-120927.svg').exists()
for retired in (
    'looper66-desktop-pitch-clean','looper66-mobile-pitch-clean',
    'looper66-desktop-transport','looper66-mobile-transport','looper66-crate-cassettes',
    'assets/looper-ui/cassette-tape.svg','assets/looper-ui/cassette-frame.svg',
    'assets/looper-ui/cassette-reel.svg','looper66-rear-cables.svg'
):
    assert retired not in HTML+CSS+LOOPER+VIEW+EVENTS,retired
assert not (ROOT/'js/looper-120927.js').exists()
assert not (ROOT/'css/looper-120927.css').exists()
assert not (ROOT/'css/looper-120927-tuning.css').exists()

# Readout is truthful: no BPM and no cosmetic LOOP ON.
for token in ('deckReadoutTrack','deckTransportState','deckTimeCurrent','deckTimeDuration','deckProgressFill','deckSpeedReadout'):
    assert f'id="{token}"' in HTML,token
assert 'LOOP: ON' not in HTML+VIEW
assert re.search(r'\bBPM\b',HTML+VIEW,re.I) is None
assert 'deckBuffer.duration' in VIEW
assert 'clockPosition+=Math.max(0,now-clockLastCtxTime)*deckRate()' in VIEW

# Existing audio/import/speed state stays authoritative.
assert 'deckOutputGain=ctx.createGain()' in LOOPER
assert 'deckOutputGain.gain.setValueAtTime' in VIEW
assert 'looperSpeedRateLevel=(looperSpeedRateLevel+1)%6' in LOOPER
assert 'const AUTO_LOOP_BATCH=8' in LOOPER
assert 'Math.max(-8,Math.min(8' in LOOPER
assert '$("importBeatsBtn")' in EVENTS and '$("importFolderBtn")' in EVENTS

# Five real speed lamps and physical HTML controls own their light state.
assert HTML.count('<i></i>')>=5
for level in range(1,6):
    assert f'data-speed-level="{level}"' in CSS
assert '--light-strength:.10' in CSS
assert '.cassetteDeck.playing #playBeat' in CSS
assert 'rgba(var(--light-r),var(--light-g),var(--light-b)' in CSS
assert 'mix-blend-mode:screen' in CSS

# Crates are real data filters, not invented genres.
for label in ('ALL BEATS','LIBRARY','IMPORTS','RECENT'):
    assert label in VIEW
for fake in ('BOOM BAP','SOUL','CHILL'):
    assert fake not in VIEW.upper()
assert 'rowSource=row=>isFolderBeat(row)?"library":"imports"' in VIEW

# Reel mechanics remain coupled to true playback rate.
assert 'animation:looperReelSpin var(--supply-reel-cycle)' in CSS
assert '.cassetteDeck.playing .cassetteReel { animation-play-state:running; }' in CSS
assert 'animation-duration:var(--takeup-reel-cycle)' in CSS
assert 'height:auto' in CSS
assert '--supply-reel-cycle' in LOOPER and '--takeup-reel-cycle' in LOOPER

assert '@media (max-width:680px)' in CSS
assert '@media (prefers-reduced-motion:reduce)' in CSS
print('OK: approved 120927 Looper contract, one asset set and existing behavior preserved')
