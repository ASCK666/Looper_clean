# 120927 migration plan — mockup-first

## Source of truth

`assets/looper-ui/120927/mockup-reference.webp` is the absolute visual reference for the desktop Looper.

Every visual change must be checked against this mockup in a real browser render before moving to the next asset.

## Non-negotiable constraints

1. **Match the mockup exactly.** No interpretation, redesign, approximation, or “inspired by” version.
2. **Rebuild every asset cleanly from the mockup.** Each asset must reproduce the same material, proportions, relief, lighting and geometry as the reference.
3. **Use the correct native size and aspect ratio.** No stretching, no `object-fit: fill`, no forced distortion, no arbitrary scaling that changes proportions.
4. **Do not stack competing assets.** A physical area or control must be drawn once. Never put a live control over a baked copy of the same control.
5. **Proceed asset by asset.** One migration step = one asset or one inseparable physical component.
6. **Validate each step in Chromium.** Integrate one asset, render the site, compare to the mockup, fix it, then continue.
7. **Preserve existing behavior.** Playback, STOP/PLAY, pitch, volume, Speed Auto, imports, crates/beats, reel rotation, reduced motion and audio behavior must continue to work.
8. **Do not keep retired visual assets as fallbacks.** Once an asset is replaced and no longer referenced, remove it.
9. **Do not add temporary skin/tuning layers.** The final visual ownership must stay simple and explicit.
10. **Static and dynamic ownership must be clear.** Static physical material belongs to assets; changing state/data belongs to live HTML/CSS/JS.

## Workflow for every step

For every asset below:

1. isolate the exact target region from `mockup-reference.webp`;
2. create the production asset at its correct native dimensions;
3. integrate only that asset;
4. remove the superseded asset/rendering for the same physical region;
5. run the browser tests;
6. capture desktop Chromium;
7. compare against the mockup;
8. do not start the next asset until the current one is visually acceptable and functionally clean.

## Migration steps — one asset per step

### Step 1 — desk / table surface
**Target:** `assets/looper-ui/120927/desk-surface.webp`

Contains only the walnut tabletop.

Requirements:
- same wood species/look, grain direction, contrast and warmth as the mockup;
- correct 1448×1086 scene relationship;
- no deck, cables, shadows or controls baked into it;
- no stretch or repeated procedural pattern unless visually indistinguishable from the reference.

Browser acceptance:
- wood around the machine matches the reference at top, sides and bottom;
- grain is not stretched.

### Step 2 — rear cables
**Target:** `assets/looper-ui/120927/rear-cables.webp`

Contains only:
- one power cable;
- two XLR-style cables/connectors.

Requirements:
- exact positions, scale and material from the mockup;
- rendered behind the chassis;
- transparent background.

### Step 3 — deck chassis / shell
**Target:** `assets/looper-ui/120927/deck-shell.webp`

Contains only static chassis material:
- graphite shell;
- chassis screws;
- panel borders;
- fixed panel relief;
- fixed printed labels that never change.

Must NOT contain:
- cassette;
- readout contents;
- pitch thumb/value state;
- transport button faces/state;
- import button faces;
- crates/beats rows;
- dynamic LEDs.

### Step 4 — readout physical background
**Target:** `assets/looper-ui/120927/readout-panel.webp`

Contains only the static screen/frame material.

Live HTML owns:
- TRACK;
- STATE;
- TIME;
- progress;
- RATE.

### Step 5 — volume / jack panel
**Target:** `assets/looper-ui/120927/utility-panel.webp`

Contains static panel material, MIC/PHONES jacks and fixed printing.

Live UI owns the functional volume control/hit area.

### Step 6 — pitch panel
**Target:** `assets/looper-ui/120927/pitch-panel.webp`

Contains static pitch-slot material and fixed printing only.

Live UI owns:
- real pitch slider;
- thumb position;
- pitch readout.

No conflicting baked pitch state may remain underneath.

### Step 7 — cassette bay / housing
**Target:** `assets/looper-ui/120927/cassette-bay.webp`

Contains only the static bay and physical surround.

The cassette itself is a separate component.

### Step 8 — cassette body
**Target:** `assets/looper-ui/120927/cassette-body.webp` or SVG only if SVG matches the raster reference exactly.

Contains:
- cassette shell;
- label surface;
- fixed A / 90 / TYPE I / NORMAL markings;
- transparent reel apertures.

Requirements:
- exact geometry from mockup;
- holes stay transparent so live reels remain behind the cassette body.

### Step 9 — cassette reel
**Target:** `assets/looper-ui/120927/cassette-reel.webp` or SVG if fidelity is exact.

Contains one reel only.

Requirements:
- exact visual shape/material;
- true centered rotation;
- separate supply/takeup timing remains functional.

### Step 10 — cassette door / glass / opening seam
**Target:** `assets/looper-ui/120927/cassette-frame.webp`

One foreground component containing:
- glass;
- door/frame;
- subtle opening interstice.

Requirements:
- covers the exact openable area;
- no screws on the glass;
- sits above cassette body/reels;
- no extra top opening mechanism, handles, pegs, vents or grille absent from mockup.

### Step 11 — STOP button face
**Target:** `assets/looper-ui/120927/button-stop.webp`

Static physical button face only. Interaction remains on the real button.

### Step 12 — PLAY button face
**Target:** `assets/looper-ui/120927/button-play.webp`

Static physical face only.

CSS owns illumination:
- very subtle static amber glow while stopped;
- stronger amber glow while playing;
- no idle pulsing.

### Step 13 — SPEED AUTO button face
**Target:** `assets/looper-ui/120927/button-speed-auto.webp`

Static physical face only.

Live UI owns five numbered LED states. No circular repeat/AUTO icon may be invented if it contradicts the approved target.

### Step 14 — IMPORT LIBRARY button
**Target:** `assets/looper-ui/120927/button-import-library.webp`

Exact cream physical face from mockup, with real existing import action as its hit target.

### Step 15 — IMPORT BEAT button
**Target:** `assets/looper-ui/120927/button-import-beat.webp`

Exact cream physical face from mockup, with real existing import action as its hit target.

### Step 16 — crates panel
**Target:** `assets/looper-ui/120927/crates-panel.webp`

Contains static panel material/header only.

Live crate/filter content is rendered once by HTML.

### Step 17 — beats panel
**Target:** `assets/looper-ui/120927/beats-panel.webp`

Contains static panel material/header/column guides only.

Live beat rows are rendered once by HTML.

## Required browser review fixture

The desktop visual test must be able to reproduce the reference state without adding fake production data:

- `MIDNIGHT SESSION.WAV`;
- state PLAYING;
- `00:42 / 02:36`;
- progress matching the reference;
- `+0.0%`;
- deterministic test-only crate and beat rows matching the visual fixture.

This fixture exists only for screenshot comparison and must not become production library data.

## Forbidden implementation patterns

- `object-fit: fill` on production visual assets;
- stretching width/height independently;
- full mockup used as an underlay beneath duplicate live controls;
- old skin + new skin retained simultaneously;
- CSS-generated fake material where a reference-derived asset is required;
- multiple assets depicting the same physical face;
- proceeding to the next asset before checking the current one in Chromium;
- modifying audio behavior to make a visual test pass.

## Definition of done

The migration is complete only when:

- the desktop Chromium render is visually indistinguishable from `mockup-reference.webp` at the approved scene ratio;
- assets are not stretched;
- every physical region has one clear visual owner;
- existing runtime behavior remains functional;
- retired assets and temporary migration layers are gone;
- maintained tests are green.
