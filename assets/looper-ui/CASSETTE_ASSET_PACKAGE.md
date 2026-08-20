# Looper66 v2 production asset package

Runtime files under `assets/looper-ui/`:

- `looper66-desktop-v2.webp` — complete horizontal powered-off skin;
- `looper66-mobile-v2.webp` — dedicated portrait powered-off skin;
- `looper66-cassette-shell-v2.webp` — transparent shell, label and lower support;
- `looper66-cassette-reel-v2.webp` — transparent complete tape reel, instantiated twice.

The two responsive skins provide the neutral deck and Beat Crate chassis. The
cassette shell and reel have real alpha transparency. Illumination and state
colour are added exclusively by CSS.

The complete reel/tape-pack image rotates independently in two instances behind
the shell while playback is active. The shell itself contains the fixed lower
mechanism and support, so those details remain visible without another runtime
layer.

The runtime stack is defined directly in `index.html`; state and timing live in
`js/looper.js`; layout, animation and backlighting live in `css/base.css`.
There is no secondary cassette runtime or late DOM mounting path.
