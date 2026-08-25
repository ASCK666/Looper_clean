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

# At rest the SLICES-specific rule owns only the neutral border. The physical
# face is owned later by the shared pad asset rule; do not duplicate it here.
rest=re.search(
    r'#chopper\.screen:has\(#waveCanvas\[data-edit-mode="slices"\]\) '
    r'\.pad:not\(\.slice-selected\):not\(\.hit\):not\(\.active\)\s*\{([^}]*)\}',
    css,re.S
)
assert rest,'missing neutral SLICES pad state'
assert '#474038' in rest.group(1),rest.group(1)
assert 'background:' not in rest.group(1),rest.group(1)
assert 'box-shadow:' not in rest.group(1),rest.group(1)

# Selection is split intentionally: the SLICES rule owns its amber border while
# the shared selected-pad owner supplies the live lamp/filter state.
selected=re.search(
    r'#chopper\.screen \.pad\.slice-selected:not\(\.hit\):not\(\.active\)\s*\{([^}]*)\}',
    css,re.S
)
assert selected,'missing selected SLICES border state'
assert '#9a7038' in selected.group(1),selected.group(1)
assert 'background:' not in selected.group(1),selected.group(1)

selected_owner=re.search(
    r'#chopper \.pad\.selected,\s*#chopper \.pad\.slice-selected\s*\{([^}]*)\}',
    css,re.S
)
assert selected_owner,'missing shared selected-pad owner'
assert '--chopper-light-core: rgba(255,238,170,.34)' in selected_owner.group(1),selected_owner.group(1)
assert 'filter: sepia(.18) saturate(.94) brightness(1.04)' in selected_owner.group(1),selected_owner.group(1)

# Unavailable pads follow the same ownership rule: SLICES owns the dark border;
# the shared unavailable owner supplies reduced opacity and grayscale.
unavailable=re.search(
    r'#chopper\.screen:has\(#waveCanvas\[data-edit-mode="slices"\]\) '
    r'\.pad\.unavailable:not\(\.hit\):not\(\.active\)\s*\{([^}]*)\}',
    css,re.S
)
assert unavailable,'missing unavailable SLICES border state'
assert '#302c27' in unavailable.group(1),unavailable.group(1)
assert 'opacity:' not in unavailable.group(1),unavailable.group(1)

unavailable_owner=re.search(
    r'#chopper \.pad\.unavailable,\s*'
    r'#chopper\.screen:has\(#waveCanvas\[data-edit-mode="slices"\]\) '
    r'\.pad\.unavailable:not\(\.hit\):not\(\.active\)\s*\{([^}]*)\}',
    css,re.S
)
assert unavailable_owner,'missing shared unavailable-pad owner'
assert 'opacity: .34 !important' in unavailable_owner.group(1),unavailable_owner.group(1)
assert 'filter: grayscale(.45) brightness(.58) !important' in unavailable_owner.group(1),unavailable_owner.group(1)

print('OK: Chopper SLICES CSS — neutral waveform/pads, ivory playhead, shared pad owners keep amber/action states explicit')
