120927 Looper production assets

Golden reference: the approved 1448×1086 mockup.

Asset contract:
- Every touched visual asset must use the approved mockup as the visual source of truth.
- Export at the target geometry/aspect ratio; no non-uniform scaling, warping or object-fit: fill.
- Desktop desk texture is assets/looper-ui/120927/desk-surface.webp at native 1448×1086.
- Rear cables are assets/looper-ui/120927/rear-cables.webp at native 1448×1086 with transparent alpha; it contains no desk or chassis pixels.
- Deck chassis is assets/looper-ui/120927/deck-shell.webp at native 1448×1086 with transparent apertures for every separately-owned module.
- Readout frame is assets/looper-ui/120927/readout-panel.webp at native 380×355; its clean glass contains no baked state or track data.
- Utility panel is assets/looper-ui/120927/utility-panel.webp at native 380×120; the stateful volume knob is intentionally transparent and remains live.
- Pitch panel is assets/looper-ui/120927/pitch-panel.webp at native 118×475; thumb, scale values and rate text remain live.
- Fixed deck/cables stay separate from the desk so the desk texture is not baked into a full-scene fallback.
- Dynamic readout, pitch, transport, import controls, library rows and cassette mechanics remain live HTML/CSS/JS.
- Superseded assets must be removed rather than retained as hidden fallbacks.
