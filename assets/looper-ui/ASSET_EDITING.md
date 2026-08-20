# Looper66 cassette asset convention

The Looper66 deck is HTML/CSS. Raster files in this directory are limited to
the cassette cavity, mechanism, shell, support, glass and reels.

## Production rules

1. Keep every production cassette source neutral and unlit. Active amber/green
   light, halos, colored reflections and state intensity belong to CSS only.
2. Keep the cassette assembly layered, from back to front: cavity, tape path,
   reels, shell, label/title, CSS light, foreground support, glass.
3. Reels stay behind the shell and glass. Animation may rotate the complete
   reel images but must never promote them above the cassette.
4. Keep runtime text out of PNG files. The beat title is the HTML element
   `#cassetteBeatName`; the source label is otherwise blank except `SIDE A`.
5. Preserve the shared `586 x 337` crop for full cassette layers. Preserve the
   `154 x 154` reel geometry and fixed centers used by `css/base.css`.
6. Do not bake an active button, Speed Rate level or playback state into an
   asset. Native HTML controls own interaction and CSS owns every state.
7. Use deterministic, bounded image edits for production assets. Generative
   output may inform a mockup but is not a drop-in production replacement.
8. Inspect changed layers at native resolution, run `python3 tools/test_all.py`,
   and inspect the desktop/mobile browser screenshots before merge.

The original full-canvas extraction files remain as reversible source material.
The `*-off.png` files are the neutral, cropped runtime assets.
