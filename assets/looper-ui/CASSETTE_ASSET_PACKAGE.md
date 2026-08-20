# Looper66 neutral cassette package

Runtime files under `assets/looper-ui/`:

- `looper-deck-faceplate-off.webp`
- `looper-beat-crate-off.webp`
- `cassette-cavity-off.png`
- `cassette-tape-path-off.png`
- `cassette-reel-left-off.png`
- `cassette-reel-right-off.png`
- `cassette-shell-off.png`
- `cassette-support-off.png`
- `cassette-glass-off.png`

The two Looper skins provide the neutral desktop deck and Beat Crate chassis.
The five full cassette layers share a transparent `586 x 337` canvas. Each reel is a
transparent `154 x 154` image. All RGB pixels in this production set are
grayscale by contract: illumination and state color are added by CSS.

The two tape strands leave the reels toward the lower outside edges. They are
static mechanism geometry. Complete reel/tape-pack images rotate independently
behind the cassette shell while playback is active.

The runtime stack is defined directly in `index.html`; state and timing live in
`js/looper.js`; layout, animation and backlighting live in `css/base.css`.
There is no secondary cassette runtime or late DOM mounting path.
