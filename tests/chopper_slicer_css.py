from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
css=(ROOT/'css/chopper-drum-controls.css').read_text(encoding='utf-8')

# SLICES should be visibly calmer than the amber-heavy MARKERS/hardware skin.
wave=re.search(r'#chopper #waveCanvas\[data-edit-mode="slices"\]\s*\{([^}]*)\}',css,re.S)
assert wave,'missing SLICES waveform treatment'
assert 'filter:' in wave.group(1),wave.group(1)
sat=re.search(r'saturate\(([^)]+)\)',wave.group(1))
assert sat and float(sat.group(1))<=.40,wave.group(1)

# Playhead is intentionally desaturated/brightened toward warm ivory so it
# remains legible without becoming another amber slice boundary.
playhead=re.search(r'#chopper #waveCanvas\[data-edit-mode="slices"\] \+ #playheadCanvas\s*\{([^}]*)\}',css,re.S)
assert playhead,'missing SLICES playhead treatment'
psat=re.search(r'saturate\(([^)]+)\)',playhead.group(1))
pbright=re.search(r'brightness\(([^)]+)\)',playhead.group(1))
assert psat and float(psat.group(1))<=.25,playhead.group(1)
assert pbright and float(pbright.group(1))>=1.10,playhead.group(1)

# At rest the pad surface must be neutral: no permanent amber radial halo.
rest=re.search(
    r'#chopper\.screen:has\(#waveCanvas\[data-edit-mode="slices"\]\) '
    r'\.pad:not\(\.slice-selected\):not\(\.hit\):not\(\.active\)\s*\{([^}]*)\}',
    css,re.S
)
assert rest,'missing neutral SLICES pad state'
assert 'radial-gradient' not in rest.group(1),rest.group(1)
assert 'rgba(226,173,95' not in rest.group(1),rest.group(1)

# Amber remains an explicit selected/action state rather than the base state.
selected=re.search(
    r'#chopper\.screen \.pad\.slice-selected:not\(\.hit\):not\(\.active\)\s*\{([^}]*)\}',
    css,re.S
)
assert selected,'missing selected SLICES pad state'
assert '#9a7038' in selected.group(1),selected.group(1)
assert 'rgba(226,173,95,.12)' in selected.group(1),selected.group(1)

# Pads without a matching slice are deliberately quieter than available pads.
unavailable=re.search(
    r'#chopper\.screen:has\(#waveCanvas\[data-edit-mode="slices"\]\) '
    r'\.pad\.unavailable:not\(\.hit\):not\(\.active\)\s*\{([^}]*)\}',
    css,re.S
)
assert unavailable and 'opacity: .58' in unavailable.group(1),unavailable.group(1) if unavailable else ''

print('OK: Chopper SLICES CSS — neutral waveform/pads, ivory playhead, amber reserved for selection/action')
