# 120927 migration plan — mockup-first

## Source of truth

`assets/looper-ui/120927/mockup-reference.png` is the absolute visual reference for the desktop Looper.

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
1. isolate the exact target region from `mockup-reference.png`;
2. create the production asset at its correct native dimensions;
3. integrate only that asset;
4. remove the superseded asset/rendering for the same physical region;
5. run browser tests;
6. capture desktop Chromium;
7. compare against the mockup;
8. do not start the next asset until the current one is visually acceptable and functionally clean.

## Migration steps — one asset per step

1. **Desk/table** — `desk-surface.webp`: walnut tabletop only; exact grain, warmth and proportions; no deck/cables baked in.
2. **Rear cables** — `rear-cables.webp`: one power cable + two XLR-style cables; transparent; exact placement and scale.
3. **Deck chassis** — `deck-shell.webp`: graphite chassis, chassis screws, panel relief/borders and fixed labels only; no dynamic controls/data.
4. **Readout background** — `readout-panel.webp`: static screen/frame material only; live HTML owns TRACK/STATE/TIME/progress/RATE.
5. **Utility panel** — `utility-panel.webp`: volume/MIC/PHONES physical panel; live volume control remains functional.
6. **Pitch panel** — `pitch-panel.webp`: static physical pitch panel only; live slider/thumb/readout owns state; no conflicting baked values.
7. **Cassette support** — `cassette-support.webp`: empty static housing only; no cassette, rail, screw, stop or reel pixels.
8. **Cassette shell** — `cassette-shell.svg`: exact shell/label/markings with transparent reel apertures.
9. **Cassette spool** — `cassette-spool.svg`: one exact mechanism, reused twice and centered for supply/takeup rotation.
10. **Cassette door/glass** — `cassette-frame.webp`: single door/glass/opening-seam foreground; exact openable area; no screws on glass.
11. **STOP button** — `button-stop.webp`: physical face only; real button owns interaction.
12. **PLAY button** — `button-play.webp`: physical face only; CSS owns subtle idle amber glow and stronger playing glow; no idle pulse.
13. **SPEED AUTO button** — `button-speed-auto.webp`: physical face only; live HTML owns five numbered LED states.
14. **IMPORT LIBRARY** — `button-import-library.webp`: exact cream physical face; existing import action remains the hit target.
15. **IMPORT BEAT** — `button-import-beat.webp`: exact cream physical face; existing import action remains the hit target.
16. **CRATES panel** — `crates-panel.webp`: static panel/header material only; live rows rendered once.
17. **BEATS panel** — `beats-panel.webp`: static panel/header/column guides only; live rows rendered once.

## Browser validation

After every asset: integrate exactly one asset → remove the old owner for that region → render in Chromium → compare with `mockup-reference.png` → fix before continuing.

The desktop test fixture may reproduce `MIDNIGHT SESSION.WAV`, PLAYING, `00:42 / 02:36`, matching progress, `+0.0%` and deterministic test-only crate/beat rows, but this data must never become fake production library data.

## Forbidden

- stretched assets;
- `object-fit: fill` for production visuals;
- a full mockup beneath duplicate live controls;
- old and new skins simultaneously;
- CSS fake materials where a reference-derived asset is required;
- multiple assets depicting the same physical face;
- migrating several visual assets in one step;
- changing audio behavior to satisfy visual tests.

## Definition of done

Desktop Chromium is visually indistinguishable from `mockup-reference.png`; no asset is stretched; each physical region has one clear visual owner; existing behavior remains functional; retired assets and temporary migration layers are gone; maintained tests are green.
