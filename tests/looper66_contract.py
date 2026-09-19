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

# The approved mockup is a non-runtime golden reference. The first migrated
# production scene keeps the approved deck geometry on a neutral web background.
assert 'assets/looper-ui/120927/' in HTML
assert 'looper66DeskSurface' not in HTML+CSS
assert 'desk-surface.webp' not in HTML+CSS
assert re.search(r'<img\b[^>]*class="looper66RearCables"[^>]*src="assets/looper-ui/120927/rear-cables\.webp"[^>]*width="1448"[^>]*height="1086"',HTML)
assert re.search(r'<img\b[^>]*class="looper66DeckShell"[^>]*src="assets/looper-ui/120927/deck-shell\.webp"[^>]*width="1448"[^>]*height="1086"',HTML)
assert re.search(r'<img\b[^>]*class="looper66CassetteSupport"[^>]*src="assets/looper-ui/120927/reader-mechanism\.webp"[^>]*width="550"[^>]*height="366"',HTML)
assert re.search(r'<img\b[^>]*class="looper66ReadoutPanel"[^>]*src="assets/looper-ui/120927/readout-panel\.webp"[^>]*width="380"[^>]*height="355"',HTML)
assert 'assets/looper-ui/120927/utility-panel.webp' in CSS
assert 'assets/looper-ui/120927/pitch-panel.webp' in CSS
assert '.looper66RearCables' in CSS
assert '#1d2022 0%,#141618 60%,#090a0b 100%' in CSS
assert not (ROOT/'assets/looper-ui/120927/desk-surface.webp').exists()
assert (ROOT/'assets/looper-ui/120927/rear-cables.webp').exists()
assert (ROOT/'assets/looper-ui/120927/deck-shell.webp').exists()
assert (ROOT/'assets/looper-ui/120927/readout-panel.webp').exists()
assert (ROOT/'assets/looper-ui/120927/utility-panel.webp').exists()
assert (ROOT/'assets/looper-ui/120927/pitch-panel.webp').exists()
assert (ROOT/'assets/looper-ui/120927/reader-mechanism.webp').exists()
assert (ROOT/'assets/looper-ui/120927/cassette-cavity.svg').exists()
assert (ROOT/'assets/looper-ui/120927/cassette.webp').exists()
assert (ROOT/'assets/looper-ui/120927/reel-animation.webp').exists()
mockup=ROOT/'assets/looper-ui/120927/mockup-reference.png'
assert mockup.exists() and mockup.read_bytes()[:8]==b'\x89PNG\r\n\x1a\n'
assert 'looper66StaticSkin' not in HTML+CSS
assert 'object-fit:fill' not in HTML+CSS.replace(' ','')
for retired in (
    'deck-static.webp','deck-shell.svg','rear-cables.svg','desk-wood.svg','deck-scene-120927.svg',
    'looper66-desktop-pitch-clean','looper66-mobile-pitch-clean',
    'looper66-desktop-transport','looper66-mobile-transport','looper66-crate-cassettes',
    'assets/looper-ui/cassette-tape.svg','assets/looper-ui/cassette-frame.svg',
    'assets/looper-ui/cassette-reel.svg','looper66-rear-cables.svg'
):
    assert retired not in HTML+CSS+LOOPER+VIEW+EVENTS,retired
assert not (ROOT/'assets/looper-ui/120927/deck-scene-120927.svg').exists()
assert not (ROOT/'js/looper-120927.js').exists()
assert not (ROOT/'css/looper-120927.css').exists()
assert not (ROOT/'css/looper-120927-tuning.css').exists()

# Readout is truthful: no BPM and no cosmetic LOOP ON.
for token in ('deckReadoutTrack','deckTransportState','deckTimeCurrent','deckTimeDuration','deckProgressFill','deckSpeedReadout'):
    assert f'id="{token}"' in HTML,token
assert 'LOOP: ON' not in HTML+VIEW+CSS
assert 'content:"LOOP:' not in CSS
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

# Desktop interaction layers reveal the exact baked mockup controls and cannot
# be recolored by Firefox dark mode or native form-control appearance.
desktop_controls=re.search(r'@media \(min-width:681px\)\s*\{(.*?)\n\}',CSS,re.S)
assert desktop_controls,desktop_controls
desktop_css=desktop_controls.group(1)
for token in ('background:transparent!important','appearance:none','-moz-appearance:none','forced-color-adjust:none','color-scheme:light'):
    assert token in desktop_css,token
assert '.deckVolumeKnob{display:none}' in desktop_css
assert '.deckLoadKey strong{' in desktop_css
assert 'font:750 clamp(9px,.86vw,13px)' in desktop_css
assert 'background:linear-gradient(#343638,#1b1d1e)' in desktop_css
assert 'color-scheme:dark' in desktop_css

# Crates are real data filters, not invented genres.
for label in ('ALL BEATS','LIBRARY','IMPORTS','RECENT'):
    assert label in VIEW
for fake in ('BOOM BAP','SOUL','CHILL'):
    assert fake not in VIEW.upper()
assert 'rowSource=row=>isFolderBeat(row)?"library":"imports"' in VIEW

# Reel mechanics remain coupled to true playback rate. The cavity has one
# background owner and no foreground pseudo-glass is allowed above the reels.
assert 'animation:looperReelSpin var(--supply-reel-cycle)' in CSS
assert '.cassetteDeck.playing .cassetteReel { animation-play-state:running; }' in CSS
assert 'animation-duration:var(--takeup-reel-cycle)' in CSS
assert 'height:auto' in CSS
assert 'cassette-cavity.svg' in CSS
assert '.cassetteMechanism::before{' in CSS
assert '.cassetteMechanism::after{' not in CSS
assert 'filter:brightness(.36)' not in CSS
assert '.cassetteReelLeft{left:20.46%;top:32.06%}' in CSS
assert '.cassetteReelRight{left:62.53%;top:32.06%;animation-duration:var(--takeup-reel-cycle)}' in CSS
assert '--supply-reel-cycle' in LOOPER and '--takeup-reel-cycle' in LOOPER

assert '@media (max-width:680px)' in CSS
assert '@media (prefers-reduced-motion:reduce)' in CSS
print('OK: approved 120927 Looper contract, mockup source and existing behavior preserved')

# Clean-tape typography keeps physical labels separate from data/readout text.
TOKENS=(ROOT/'css/tokens.css').read_text(encoding='utf-8')
assert '--font-ui:' in TOKENS and '--font-condensed:' in TOKENS and '--font-mono:' in TOKENS
assert 'font-family:var(--font-condensed' in CSS
assert '--deck-amber-dim:' in CSS

# Clean-tape visual hierarchy keeps active transport and imports hardware-dark.
assert '.cassetteDeck.playing #playBeat' in CSS and 'background:linear-gradient(#414445,#272a2b' in CSS
assert '.crateFilterButton[aria-pressed="true"]{--light-strength:0' in CSS
assert 'min-height:1210px' in CSS and 'height:128px' in CSS

# Clean-tape keeps visible Looper machine copy in one language.
assert 'BEAT IMPORT' in HTML and 'IMPORT SAMPLES' not in HTML
assert 'NO BEAT LOADED' in HTML+LOOPER+VIEW
for french in ('Aucun beat chargé','Aucun beat disponible','CHARGEMENT…','PRÊT • APPUYER SUR PLAY'):
    assert french not in HTML+LOOPER+VIEW,french

# Clean-tape selected beat uses hardware-dark selection instead of a full amber fill.
assert '.beatListRow[aria-current="true"]{background:#191d1e' in CSS
assert 'background:linear-gradient(90deg,#f0a126,#d9860c)' not in CSS

# Clean-tape readout progress renders as discrete hardware segments.
assert 'background:repeating-linear-gradient(90deg,#24190d 0 8px' in CSS
assert 'background:repeating-linear-gradient(90deg,#ffb13b 0 8px' in CSS
