# Mobile Chopper target UX — branch `asset-ui-chopper`

This document defines the target mobile experience for the Chopper. It is a UX/product guide, not an implementation plan. Desktop behaviour and current audio/runtime ownership remain unchanged unless a later task explicitly asks to change them.

## Product goal

On a phone, the Chopper must feel like an instrument first and an editor second.

The core loop is:

`find a part -> play a pad -> hear a bad cut -> hold the pad -> fix START/END -> return to pads -> play again`

The user must never need DAW-style precision dragging to make a clean chop.

## Non-negotiable mental model

- One pad represents one chop.
- Tapping a pad plays that chop immediately.
- Holding that same pad opens the editor for that exact chop.
- Returning from the editor goes directly back to the pads, preserving the selected chop.
- The global waveform is for orientation and selection, not for precise finger editing.
- Precise START/END adjustment is done with dedicated controls.
- The current working audio portion remains a small chunk (about 30 seconds), and chops stay bound to pads inside that portion.

## Root mobile views

The mobile Chopper is split into four focused views instead of one long desktop-style page:

1. `CHOP` / global waveform
2. `PADS`
3. `SEQUENCE`
4. `DRUMS`

A compact header exposes previous/next navigation and the current view name:

```text
‹          PADS          ›
```

A small page indicator may be used as secondary orientation, for example:

```text
○  ●  ○  ○
```

Horizontal swipe can be added as a secondary shortcut, but visible navigation controls remain the primary discoverable path.

## Persistent transport

The primary transport stays easy to reach from every Chopper view.

- `PLAY` starts the relevant current playback flow.
- `STOP` is global and absolute.
- `STOP` must silence every audio source immediately: looper playback, pad/chop voices, sequencer, drums, previews and audible FX tails.
- No Chopper sub-view may redefine STOP as a local-only action.

Visual target:

- all hardware-style buttons have a subtle low-level backlight at rest;
- active/pressed state increases the light clearly;
- STOP keeps a restrained red identity even at rest;
- STOP must still include a clear text/icon label and never rely on red alone.

## PADS view

The pads are the main performance surface.

Target layout: 16 pads in a 4 x 4 grid, with touch targets large enough for phone use.

### Pad gestures

**Tap**

- Plays the pad immediately.
- Must not wait to detect a possible double tap.
- Retriggering the same pad quickly remains a valid musical gesture.

**Long press**

- Opens the editor for that pad's chop.
- The transition should feel like inspecting the current pad, not entering a separate application section.
- Give immediate visual pressed-state feedback during the hold.
- A short confirmation pulse/animation can mark the moment edit mode is entered.

Do not use double tap as the primary edit gesture because it conflicts with musical retriggering.

## First-use discovery of long press

Long press is efficient but invisible, so it must be taught once without blocking play.

On the first relevant pad interaction:

1. The first tap still plays the sound normally.
2. A short, non-modal coach animation appears on/near that pad.
3. It demonstrates a hold gesture and communicates the equivalent of `Hold pad to edit chop`.
4. The hint disappears automatically and does not interrupt further pad taps.
5. Once learned/dismissed, it should not keep reappearing during normal use.

Avoid a full-screen tutorial or modal dialog.

## CHOP / global waveform view

The global waveform answers one question:

> Where am I in the current audio portion?

It must:

- show the full working portion (about 30 seconds);
- show chop boundaries clearly;
- highlight the selected chop strongly;
- allow easy chop selection by tap;
- preserve context while a chop is being edited.

It must **not** require the user to drag tiny boundary markers precisely with a finger.

Direct dragging may remain as an optional coarse gesture later, but precise editing must always be possible without it.

## Individual chop editor

Long-pressing a pad opens the editor for that chop.

The editor is a focused detail state, not a fifth top-level workspace.

Suggested header:

```text
‹ PADS          CHOP 07          08 ›
```

Requirements:

- one-action return to `PADS`;
- current chop number is always obvious;
- previous/next chop access is available without returning to the grid;
- returning to PADS restores the same pad context/selection.

### Global overview inside the editor

Keep a compact global waveform visible so the user never loses position in the source.

The selected chop must remain highlighted in that overview.

### Precise START / END editing

Phone precision comes from dedicated nudging controls, not tiny draggable handles.

Minimum control model:

```text
START
[ ‹ ]             [ › ]

END
[ ‹ ]             [ › ]
```

or equivalent `- / +` controls.

Behaviour target:

- tap = small precise nudge;
- hold = continuous movement;
- sustained hold may accelerate progressively so large corrections do not require dozens of taps;
- movement is immediately reflected in the waveform and chop boundaries;
- controls must remain comfortably tappable (target about 44 x 44 CSS px minimum).

Do not expose permanent `1 ms / 5 ms / 20 ms`, `FINE`, `COARSE` or similar technical mode clutter in the first mobile version unless testing proves it is necessary.

### Detailed waveform

The detailed waveform is for visual precision around the active boundary.

Preferred mobile direction:

- compact global overview at the top;
- one large detailed waveform below;
- explicit `START` / `END` selector;
- the large detail view focuses on whichever boundary is currently active.

This uses the full phone width for the current precision task instead of forcing two tiny zoom windows side by side.

Example:

```text
‹ PADS            CHOP 07

[ global waveform / chop context ]

       START      END
       =====      ---

┌──────────────────────────┐
│       detailed waveform  │
│             │            │
│             ▲ cut point  │
└──────────────────────────┘

        [ ‹ ]   [ › ]

        [ ▶ PLAY CHOP ]
```

### Audition

A dedicated one-tap `PLAY CHOP` / audition action must be easy to reach while editing.

The edit loop should be fast enough to repeat naturally:

`audition -> nudge -> audition -> nudge -> next chop`

Automatic audition after each nudge can be tested later, but is not required for the first target version.

## SEQUENCE view

The sequence grid gets its own mobile screen so it does not compete spatially with pads or the waveform.

Goals:

- large touchable steps;
- clear currently playing step;
- direct relationship to the same pad/chop identities;
- no need to scroll through waveform/pads/drums to reach the sequencer.

The sequence screen should remain a quick backing-beat tool, not grow into a full piano-roll DAW.

## DRUMS view

Drums get their own focused mobile screen.

Keep the primary kick/snare/hat pattern interaction prominent. Secondary sound-shaping controls should not crowd the first viewport.

The guiding rule is the same as elsewhere: fast enough to build something to scratch over, not a complete drum-production environment.

## Navigation and state rules

- Switching between root Chopper views must not lose the loaded audio portion, chops, pad assignments, sequence or drum pattern.
- Opening/closing an individual chop editor must not restart or rebuild unrelated state.
- The selected pad/chop identity follows the user between PADS, CHOP and the editor.
- A user should always be able to understand which chop they are editing without relying on waveform position alone.

## Mobile interaction principles

1. **Finger for selection and performance; controls for precision.**
2. **One screen, one main job.**
3. **No hidden gesture without first-use teaching.**
4. **No gesture that steals a useful musical gesture.**
5. **No precision workflow that requires pinch/zoom/drag gymnastics.**
6. **Keep context visible while zooming into detail.**
7. **Return to performance in one action.**
8. **STOP always means silence now.**

## Explicitly avoid in the target version

- double tap to edit a pad;
- mandatory precision dragging of chop markers;
- modal onboarding;
- nested settings pages for START/END precision;
- permanent fine/coarse/millisecond mode controls unless user testing demands them;
- turning the sequence view into a full DAW editor;
- adding unrelated synthesis/mixing features to the mobile Chopper flow;
- hiding the route back to PADS from the chop editor.

## Acceptance checks

At phone width, verify all of the following:

- The four root views are reachable without vertical hunting through one giant page.
- Every main touch target is approximately 44 x 44 CSS px or larger.
- A pad tap triggers sound immediately with no double-tap detection delay.
- Holding a pad opens the correct chop editor.
- First-use long-press guidance is non-modal and does not block normal pad playback.
- The editor shows both global source context and a precise local waveform view.
- START and END can be corrected precisely without dragging a small marker.
- Holding a nudge control can cover a larger correction without repeated tapping.
- `PADS` is reachable from the chop editor in one action.
- Returning to PADS preserves the edited/selected pad context.
- Previous/next chop editing does not require returning to PADS.
- The current ~30-second working portion and pad/chop bindings remain stable during navigation.
- STOP silences all currently audible product sources and tails.
- Buttons remain subtly backlit at rest; STOP has a restrained red treatment.
- 320 CSS px width does not create page-level horizontal overflow.
- The interface remains understandable without showing advanced editing terminology.

## Product boundary

The purpose of the mobile Chopper is not to compete with a DAW on feature count.

Its advantage should be the shortest possible path between performance and correction:

`play -> notice -> hold -> fix -> return -> play`

If a new control makes that loop slower or harder to understand, it does not belong in the primary mobile Chopper surface.
