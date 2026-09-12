# Looper66 pixel UI specification

This document is the acceptance contract for branch `ui-pixel-200826`.
Implementation work must be checked against it at every important milestone.

On `cassette-rebuild`, [CASSETTE_REBUILD.md](CASSETTE_REBUILD.md) supersedes the
cassette assets, construction, state visibility and layer order below. The
following cassette details describe the historical `090927` implementation.

On branch `210826`, the narrower desktop side controls and reduced speed-readout
hierarchy in `UI_210826_SPEC.md` override the equal desktop transport dimensions
below. The phone contract remains unchanged.

On branch `090927`, the approved transport geometry is intentionally asymmetric
on desktop: `STOP / PLAY / SPEED UP` retain the existing `28 / 44 / 28` grid
proportions. Do not normalize those widths. Dedicated powered-off transport
artwork supplies the hardware material on desktop and phone, while the native
HTML buttons remain transparent interactive hotspots above it. Runtime amber
lighting reuses crops of the same transport artwork; DOM labels and vector
symbols remain available for semantics/fallback but are not the primary rendered
button faces. The cassette foreground remains unchanged as an asset; CSS owns
the visible magnetic tape, lighting and restrained glass reflections while
preserving its transparent aperture, hinges, layer order and animated reel
coordinates.

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
- `assets/looper-ui/looper66-desktop-transport-square-3d62809d.webp` (`750 × 224`);
- `assets/looper-ui/looper66-mobile-transport-fbd6a0d3.webp` (`379 × 215`);
- `assets/looper-ui/looper66-cassette-bay-d7d5e6d4.png` (`793 × 496`), habitacle au premier plan : cadre fixe à quatre vis, porte fermée avec joint continu, deux charnières inférieures et verrou supérieur central. L'ouverture et l'extérieur sont réellement transparents. Le PNG fingerprinté conserve les dimensions, les calques et les coordonnées des bobines animées ; aucune animation d'ouverture n'est ajoutée.

These files are the composition, spacing, material and typography references.
Where a reference conflicts with a behavioural requirement below, the
behavioural requirement wins. On `090927`, the current asymmetric desktop
transport proportions are the approved geometry; consistency means matching
material, depth, lighting and artwork language rather than equalizing widths.
All amber illumination remains runtime CSS.

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
- `STOP`, `PLAY` and `SPEED UP` form one balanced transport row.
- On `090927`, preserve the existing `28 / 44 / 28` transport proportions and
  current heights. Do not resize them to equal dimensions.
- `STOP`, `PLAY` and `SPEED UP` must share the same deck-specific material,
  depth language and powered-off artwork treatment despite their different
  dimensions.
- The Beat Crate occupies the lower section.
- `PREVIOUS` and `NEXT` belong to the Beat Crate footer, not to the cassette
  transport row.

## 4. Phone composition

- HTML state readout at the top.
- Large readable cassette.
- Thumb-friendly `PLAY`, `STOP` and `SPEED UP` controls.
- `STOP` and `PLAY` occupy equal top-row modules in that order; `SPEED UP`
  occupies the full second row and keeps five inactive neutral lenses in the
  asset for CSS state lighting.
- Horizontal Pitch control.
- `LOAD LIBRARY` and `LOAD BEAT` controls.
- Vertical Beat Crate with `PREVIOUS` and `NEXT` in its navigation footer.

## 5. Cassette construction

- Use a transparent cassette shell with visible reels and visible brown magnetic
  tape around the hubs.
- On `090927`, the magnetic tape is represented by two circular wound packs
  around the hubs. Their centres remain open for the animated reels, and the
  space between the two packs remains visibly transparent.
- Each wound pack should read as one continuous translucent mass with only a few
  restrained concentric striations. Do not render a stack of equally weighted
  rings that reads like a target.
- Do not draw a bridge, diagonal connector, tangent shoulder or lower tape run
  across the clear aperture on `090927`.
- Place a substantial matte-black label around the reel openings.
- The label must stop above the lower mechanism.
- Roughly the lower 30 percent of the cassette remains clear so the lower
  mechanism and foreground support stay visible.
- The static label remains blank apart from an optional small `SIDE A` mark.
- Never bake a track name or changing value into the cassette asset.
- Render the current beat name exclusively as HTML over the reserved blank label
  field.

Required back-to-front runtime layer order on `090927`:

1. responsive powered-off deck skin;
2. cassette interior/tape material;
3. two animated reel instances;
4. CSS-controlled cassette lighting;
5. HTML beat name;
6. CSS glass reflection;
7. transparent cassette foreground / fixed door frame.

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
- a slow Play pulse only while no beat is loaded, with a static low-light fallback under reduced-motion preferences;
- Stop;
- Previous;
- Next;
- Load Library;
- Load Beat;
- Speed Up;
- Pitch;
- Auto.

Requirements:

- use native `<button>` elements for buttons;
- use a native `<input type="range">` for Pitch;
- preserve correct labels and `aria-label` values;
- preserve keyboard operation;
- provide a visible `:focus-visible` treatment;
- never ship a decorative control that has no product behaviour.

For `STOP`, `PLAY` and `SPEED UP` on `090927`, the HTML controls are visually
transparent over the dedicated transport artwork. They remain visible to the
accessibility tree and fully interactive. Do not replace the deck-specific
hardware faces with the shared generic key surface merely because the semantic
button elements exist.

## 8. Speed Up

- The hardware button is labelled **SPEED UP**, with the smaller explanatory
  subtitle `+1% / 8 LOOPS`.
- Do not bake active segments or a current value into the asset.
- Level 0 disables automatic acceleration.
- Five successive clicks select `+1%`, `+2%`, `+3%`, `+4%` and `+5%` applied
  after every eight completed loops.
- The next click returns to level 0.
- A dynamic HTML readout may show the selected level outside the static artwork.
- CSS lighting intensity communicates the selected level on the hardware button.
- Loading a new beat resets the playback speed and Speed Up level to zero.

## 9. Pitch and Auto

- Pitch is a real range from `-8%` through `0` to `+8%`.
- Manual Pitch changes the beat base playback rate and disables automatic ramping.
- `AUTO` re-enables Speed Up application every eight completed loops.
- Auto has its own CSS-controlled lit state.
- This branch does not add BPM detection or a time-stretch engine.

## 10. CSS-only backlighting

All source assets represent powered-off hardware.

Do not bake any of the following into an asset:

- amber or coloured halos;
- already-lit buttons;
- coloured light reflections;
- active Speed Up segments;
- fake illuminated bloom.

Assets may contain neutral dark lenses, transparent apertures and alpha masks.
CSS owns colour, strength, blur, transitions, hover, focus, pressed, disabled and
product-state lighting. The active palette is a warm yellow. Transport lighting
reuses the exact button crop from the dedicated transport artwork as a CSS blend
layer, so the engraved icon, label and inset trim light up without a rectangular
colour wash. A weak central falloff supplies the reflected light; CSS box
outlines and broad orange blooms are not used as the primary hardware treatment.
Interactive HTML overlays must not draw a second material surface over the
hardware borders already present in the reference artwork. Keyboard focus remains
visible as an accessibility affordance.

CSS lighting must independently support:

- Play;
- Speed Up level;
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
- Keep one Speed Up state machine, one cassette animation system and one
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
- Assert that desktop `STOP / PLAY / SPEED UP` keep the approved `28 / 44 / 28`
  proportions and are not normalized to equal widths.
- Verify that desktop and phone transport use their dedicated powered-off assets
  and that native buttons remain transparent interaction layers.
- Verify the Speed Up cycle `0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 0`.
- Verify rate application after every eight completed loops.
- Verify reset behaviour when a new beat loads.
- Verify that the cassette beat name comes from HTML.
- Verify that reel animation starts and stops with playback.
- Verify that both brown circular wound packs remain visible through the cassette
  aperture at desktop and phone sizes, with transparent centres and a clear gap
  between them.
- Verify that no connector, lower run or diagonal tape bar crosses the clear
  cassette aperture on `090927`.
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