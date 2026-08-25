#!/usr/bin/env python3
"""Reject retired visual assets that silently inflate deployable archives."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
EXPECTED_VISUALS = {
    "deck-black-ui-texture.png",
    "looper-ui/chopper-looper-button-off-alpha-6920266c.webp",
    "looper-ui/looper66-desktop-pitch-clean-1e6d4f36.webp",
    "looper-ui/looper66-mobile-pitch-clean-c034fcbb.webp",
    "looper-ui/looper66-mobile-transport-fbd6a0d3.webp",
    "looper-ui/looper66-desktop-transport-square-3d62809d.webp",
    "looper-ui/looper66-crate-cassettes.webp",
    "looper-ui/looper66-cassette-bay-b10ab679.png",
}

actual_visuals = {
    path.relative_to(ASSETS).as_posix()
    for path in ASSETS.rglob("*")
    if path.is_file() and path.suffix.lower() in {".png", ".webp", ".jpg", ".jpeg", ".gif"}
}
unexpected = sorted(actual_visuals - EXPECTED_VISUALS)
missing = sorted(EXPECTED_VISUALS - actual_visuals)

if missing or unexpected:
    if missing:
        print(f"FAIL: missing production assets: {', '.join(missing)}")
    if unexpected:
        print(f"FAIL: untracked top-level assets: {', '.join(unexpected)}")
    sys.exit(1)

print("OK: asset health — 8 production visuals, no retired deck artwork")
