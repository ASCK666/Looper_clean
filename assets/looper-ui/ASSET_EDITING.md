# Looper66 cassette asset convention

The Looper66 deck uses two responsive raster skins plus separate cassette shell
and reel components. Native HTML remains responsible for every interaction.

## Production rules

1. Keep every production cassette source neutral and unlit. Active amber/green
   light, halos, colored reflections and state intensity belong to CSS only.
2. Keep the cassette assembly layered, from back to front: deck skin, two reel
   instances, transparent cassette shell, HTML beat title, CSS light and glass.
3. Reels stay behind the shell and glass. Animation may rotate the complete
   reel images but must never promote them above the cassette.
4. Keep runtime text out of PNG files. The beat title is the HTML element
   `#cassetteBeatName`; the source label is otherwise blank except `SIDE A`.
5. Preserve the desktop skin at `1536 x 1024`, the phone skin at `941 x 1672`,
   and the transparent component aspect ratios used by `css/base.css`.
6. Do not bake an active button, Speed Rate level or playback state into an
   asset. Native HTML controls own interaction and CSS owns every state.
7. Keep the approved generated compositions as the production reference. Any
   later edit must preserve transparent apertures and powered-off lighting.
8. Inspect changed layers at native resolution, run `python3 tools/test_all.py`,
   and inspect the desktop/mobile browser screenshots before merge.

The older extraction files remain as reversible source material. Only the four
`looper66-*-v2.webp` files are referenced by the Looper66 runtime.
