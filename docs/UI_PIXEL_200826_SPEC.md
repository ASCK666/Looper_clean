# Looper66 pixel UI specification

This document is the acceptance contract for branch `ui-pixel-200826`.
Implementation work must be checked against it at every important milestone.

## 1. Visual identity

- The product name is exactly **Looper66**.
- The wordmark is sober, matte and readable.
- `66` uses the same baseline, size, colour and material treatment as `Looper`.
- No gold, glossy, raised or badge-like treatment is allowed on `66`.
- The visual language is crisp pixel art inspired by dark hip-hop and boom-bap
  studio hardware.
- The base palette is black, charcoal and muted cream. Active colour comes from
  runtime CSS lighting, not from baked illumination.
- Do not add graffiti, scribbles, marker tags, stickers or adhesive tape.
- Hardware wear, if present, must remain subtle and uniform.

## 2. Responsive compositions

Visual references committed with this contract:

- `assets/looper-ui/looper66-desktop-pitch-clean-1e6d4f36.webp` (`1086 × 1009`);
- `assets/looper-ui/looper66-mobile-pitch-clean-c034fcbb.webp` (`441 × 849`);
- `assets/looper-ui/looper66-cassette-bay-b10ab679.png` (`793 × 496`), habitacle complet au premier plan : charnière et cadre supérieur, montants latéraux, traverse de maintien inférieure et ouverture transparente. Son PNG alpha fingerprinté évite tout fond clair ou ancien asset mis en cache.

These files are the composition, spacing, material and typography references.
Where a reference conflicts with a behavioural requirement below, the
behavioural requirement wins. In particular, the three desktop transport
modules remain equal-sized and all amber illumination remains runtime CSS.

- Keep one semantic DOM and one behaviour implementation.
- Provide a horizontal desktop/tablet composition.
- Provide a dedicated vertical phone composition.
- A second phone skin is acceptable and preferred over shrinking the desktop
  faceplate until controls become unusable.
- Do not duplicate element IDs, product state or event behaviour between skins.
- Phone touch targets must be at least 44 by 44 CSS pixels.

## 3. Desktop composition

- State and speed readout on the left.
- Vertical `PITCH` module.
- Animated cassette in the centre.
- `LOAD LIBRARY` and `LOAD BEAT` controls on the right.
- `PLAY`, `STOP` and `SPEED RATE` form one balanced transport row.
- The outer hardware boxes for `PLAY`, `STOP` and `SPEED RATE` must have equal
  width, height, depth and border treatment.
- The Beat Crate occupies the lower section.
- `PREVIOUS` and `NEXT` belong to the Beat Crate footer, not to the cassette
  transport row.

## 4. Phone composition

- HTML state readout at the top.
- Large readable cassette.
- Thumb-friendly `PLAY`, `STOP` and `SPEED RATE` controls.
- Horizontal Pitch control.
- `LOAD LIBRARY` and `LOAD BEAT` controls.
- Vertical Beat Crate with `PREVIOUS` and `NEXT` in its navigation footer.

## 5. Cassette construction

- Use a transparent cassette shell with visible reels.
- Place a substantial matte-black label around the reel openings.
- The label must stop above the lower mechanism.
- Roughly the lower 30 percent of the cassette remains clear so the lower
  mechanism and foreground support stay visible.
- The static label remains blank apart from an optional small `SIDE A` mark.
- Never bake a track name or changing value into the cassette asset.
- Render the current beat name exclusively as HTML over the reserved blank label
  field.

Required back-to-front runtime layer order:

1. responsive powered-off deck skin;
2. two animated complete reel/tape-pack instances;
3. transparent cassette shell containing the fixed lower mechanism, support and
   blank label;
4. HTML beat name;
5. CSS-controlled lighting;
6. CSS glass reflection.

The reels must never be composited over the cassette. They rotate behind the
shell and remain visible through the shell openings or transparency.

## 6. Reel animation

- Both reels rotate only while a beat is playing.
- `STOP` stops the visual rotation immediately.
- Reel cycle duration follows the real beat playback rate.
- Do not generate animation frames in JavaScript.
- Respect `prefers-reduced-motion`.
- Keep only one production reel-animation path.

## 7. Native HTML controls

The following deck controls are real native HTML controls positioned over their
matching hardware artwork:

- Play;
- Stop;
- Previous;
- Next;
- Load Library;
- Load Beat;
- Speed Rate;
- Pitch;
- Auto.

Requirements:

- use native `<button>` elements for buttons;
- use a native `<input type="range">` for Pitch;
- preserve correct labels and `aria-label` values;
- preserve keyboard operation;
- provide a visible `:focus-visible` treatment;
- never ship a decorative control that has no product behaviour.

The HTML may be visually transparent over the skin, but it must remain visible
to the accessibility tree and fully interactive.

## 8. Speed Rate

- The hardware button is labelled only **SPEED RATE**.
- Do not bake `+1%`, `EVERY 8 LOOPS`, active segments or a current value into the
  asset.
- Level 0 disables automatic acceleration.
- Five successive clicks select `+1%`, `+2%`, `+3%`, `+4%` and `+5%` applied
  after every eight completed loops.
- The next click returns to level 0.
- A dynamic HTML readout may show the selected level outside the static artwork.
- CSS lighting intensity communicates the selected level on the hardware button.
- Loading a new beat resets the playback speed and Speed Rate level to zero.

## 9. Pitch and Auto

- Pitch is a real range from `-8%` through `0` to `+8%`.
- Manual Pitch changes the beat base playback rate and disables automatic ramping.
- `AUTO` re-enables Speed Rate application every eight completed loops.
- Auto has its own CSS-controlled lit state.
- This branch does not add BPM detection or a time-stretch engine.

## 10. CSS-only backlighting

All source assets represent powered-off hardware.

Do not bake any of the following into an asset:

- amber or coloured halos;
- already-lit buttons;
- coloured light reflections;
- active Speed Rate segments;
- fake illuminated bloom.

Assets may contain neutral dark lenses, transparent apertures and alpha masks.
CSS owns colour, strength, blur, inner and outer glow, transitions, hover,
focus, pressed, disabled and product-state lighting.
The active palette is a warm yellow with a compact three-stage falloff; broad
orange blooms that spill across hardware borders are not permitted.
Interactive HTML overlays must not draw an additional frame or outline over
the hardware borders already present in the reference artwork.

CSS lighting must independently support:

- Play;
- Speed Rate level;
- Auto;
- Previous and Next;
- Load Library and Load Beat;
- cassette backlight.

## 11. Runtime architecture and removal of dead paths

- Preserve the documented classic-script runtime and load order.
- Do not introduce a framework, TypeScript, modules or a state library.
- `looper.js` owns Looper state and complete Looper transitions.
- `events.js` remains DOM-event wiring.
- `bootstrap.js` must not replace Looper behaviour with late `onclick`
  monkeypatches.
- Keep one Speed Rate state machine, one cassette animation system and one
  readout system.
- Remove the implementation path replaced by this work in the same change.
- Remove CSS selectors, functions and runtime asset references that become
  provably unused.
- Do not leave active production files or comments labelled `staged`.
- Verify references before removing an asset.

## 12. Acceptance checks

- Run the maintained test suite before and after implementation.
- Run `git diff --check`.
- Verify desktop, tablet and phone layouts without horizontal overflow.
- Verify phone touch-target sizes.
- Verify hotspot-to-artwork alignment in both skins.
- Assert equal desktop dimensions for `PLAY`, `STOP` and `SPEED RATE`.
- Verify the Speed Rate cycle `0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 0`.
- Verify rate application after every eight completed loops.
- Verify reset behaviour when a new beat loads.
- Verify that the cassette beat name comes from HTML.
- Verify that reel animation starts and stops with playback.
- Verify that reels remain behind the cassette shell and in front of the
  mechanism.
- Verify that all coloured backlighting is runtime CSS, not baked artwork.
- Verify that retired runtime paths are no longer referenced.
- Verify that no JavaScript or browser console errors are introduced.
- Retiring a legacy service worker must never navigate or replace an already
  rendered Looper66 client; cache cleanup stays background-only.

## 13. Delivery workflow

1. Create `ui-pixel-200826` from `looper-next`.
2. Commit and push this specification before changing the product.
3. Run the baseline suite and inspect documented architecture ownership.
4. Implement the UI in coherent, reviewable responsibilities.
5. Check this document at each important milestone.
6. Remove replaced code and asset references.
7. Run all acceptance checks.
8. Push the completed branch without merging it.
