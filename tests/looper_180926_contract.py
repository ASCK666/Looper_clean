"""Focused static contract for the 180926 Looper visual corrections."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / 'index.html').read_text(encoding='utf-8')
css = (ROOT / 'css/looper.css').read_text(encoding='utf-8')

assert 'looper.css?v=180926' in html
assert html.count('cassette-under-tape.svg') == 1

assert '#looper .cassetteUnderTape{z-index:1' in css
assert re.search(r'\.cassetteReel\s*\{[^}]*z-index:2', css, re.S)
assert re.search(r'\.cassetteTape\s*\{[^}]*z-index:3', css, re.S)

desktop_knob = re.search(r'\.deckVolumeKnob\s*\{([^}]*)\}', css, re.S)
assert desktop_knob and 'display:none' in desktop_knob.group(1)
mobile = css[css.index('@media (max-width:680px)'):]
assert re.search(r'\.deckVolumeKnob\s*\{[^}]*display:block', mobile, re.S)

desktop_key = re.search(r'\.deckLoadKey\s*\{([^}]*)\}', css, re.S)
assert desktop_key and 'background:transparent' in desktop_key.group(1)
assert 'color:transparent' in desktop_key.group(1)
assert re.search(r'\.deckLoadKey\s*\{[^}]*background:linear-gradient', mobile, re.S)

utility = re.search(r'\.deckUtilityPanel\s*\{([^}]*)\}', css, re.S)
assert utility and utility.group(1).count('radial-gradient') == 2
pitch = re.search(r'\.deckPitchModule\s*\{([^}]*)\}', css, re.S)
assert pitch and pitch.group(1).count('radial-gradient') == 4
assert css.count('.beatCratePanel::before') == 1
crate_pair = re.search(r'\.cratePanel,#looper \.beatListPanel\s*\{([^}]*)\}', css, re.S)
assert crate_pair and 'z-index:1' in crate_pair.group(1)
assert 'border:0' in crate_pair.group(1)

print('OK: 180926 under-tape, shared crate chassis, panel screws, and mockup-native desktop controls are explicit')
