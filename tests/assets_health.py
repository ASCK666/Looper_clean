#!/usr/bin/env python3
"""Keep one production visual set and reject retired Looper artwork."""
from pathlib import Path
import sys
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'assets'
EXPECTED_VISUALS={
    'deck-black-ui-texture.png',
    'looper-ui/chopper-looper-button-off-alpha-6920266c.webp',
    'looper-ui/120927/mockup-reference.png',
    'looper-ui/120927/desk-surface.webp',
    'looper-ui/120927/rear-cables.webp',
    'looper-ui/120927/deck-shell.webp',
    'looper-ui/120927/cassette-body.svg',
    'looper-ui/120927/cassette-reel.svg',
    'looper-ui/120927/cassette-frame.svg',
}
actual={
    path.relative_to(ASSETS).as_posix()
    for path in ASSETS.rglob('*')
    if path.is_file() and path.suffix.lower() in {'.png','.webp','.jpg','.jpeg','.gif','.svg'}
}
missing=sorted(EXPECTED_VISUALS-actual)
unexpected=sorted(actual-EXPECTED_VISUALS)
if missing or unexpected:
    if missing: print('FAIL: missing production assets: '+', '.join(missing))
    if unexpected: print('FAIL: retired/untracked visual assets: '+', '.join(unexpected))
    sys.exit(1)

cables=Image.open(ASSETS/'looper-ui/120927/rear-cables.webp').convert('RGBA')
alpha=cables.getchannel('A')
if cables.size != (1448,1086) or alpha.getbbox() != (298,0,1222,103):
    print(f'FAIL: rear cables must remain native and tightly isolated: {cables.size=} {alpha.getbbox()=}')
    sys.exit(1)
if alpha.crop((0,103,1448,1086)).getbbox() is not None:
    print('FAIL: rear cables contain pixels from the deck or desk')
    sys.exit(1)
print(f'OK: asset health — {len(EXPECTED_VISUALS)} production visuals, one Looper asset set')
