120927 Looper production assets

Golden reference: the approved 1448×1086 mockup.

Asset contract:
- Every touched visual asset must use the approved mockup as the visual source of truth.
- Export at the target geometry/aspect ratio; no non-uniform scaling, warping or object-fit: fill.
- Desktop desk texture is assets/looper-ui/120927/desk-walnut.webp at native 1448×1086.
- Fixed deck/cables stay separate from the desk so the desk texture is not baked into a full-scene fallback.
- Dynamic readout, pitch, transport, import controls, library rows and cassette mechanics remain live HTML/CSS/JS.
- Superseded assets must be removed rather than retained as hidden fallbacks.
