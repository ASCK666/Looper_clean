# CSS workflow — current runtime and migration discipline

This document describes the **current browser reality** on branch `230826` and the
safe workflow for moving toward `docs/CSS_TARGET_ARCHITECTURE.md`.

The current state is transitional debt, not the target architecture.

## Current runtime truth

`index.html` currently loads these stylesheets in this order:

```text
css/base.css
css/clean-ui.css
css/chopper-drum-controls.css
```

`js/bootstrap.js` also injects:

```text
css/chopper-deck-texture.css
```

at runtime so that it loads late enough to win part of the cascade.

That JavaScript-injected stylesheet and the current cross-file overrides are
explicit migration targets. Do not add new rules to them merely because they are
convenient late layers.

There is no CSS generator pipeline and no hidden source directory. Runtime CSS is
maintained directly.

## Target ownership

The target is documented in `docs/CSS_TARGET_ARCHITECTURE.md`:

```text
css/tokens.css
css/shared.css
css/looper.css
css/chopper-sampler.css
css/chopper-sequence.css
css/chopper-drums.css
```

This is an ownership model, not a mandatory file-count goal. A stylesheet exists
only when it has one clear responsibility.

The governing rule is:

> A component has one CSS owner. Another stylesheet must not correct it later in
> the cascade.

During migration, existing legacy files may temporarily remain, but their
responsibility may only shrink. Do not add new product behavior to an override
layer that is scheduled for retirement.

## Safe micro-change loop

Every runtime CSS/HTML change is one micro-change.

1. State the single ownership/cascade problem being removed.
2. Record the architecture score before the change using
   `docs/CSS_TARGET_ARCHITECTURE.md`.
3. Identify the component owner and the smallest focused regression test.
4. Make the smallest direct edit.
5. Delete declarations/selectors/files made obsolete by that edit in the **same
   change**; do not leave a compatibility copy.
6. Run the focused test first.
7. Run CSS health/redundancy/ownership guards.
8. Run affected desktop/tablet/mobile browser/layout checks.
9. Run `git diff --check`.
10. Run `python3 tools/test_all.py`.
11. Self-audit the diff for dead code, duplicate ownership, new specificity
    escalation, new `!important`, runtime stylesheet injection and unintended
    visual/behavior changes.
12. Rescore every category and record `before -> after`.
13. Accept the change only if **no category and no total score decreased**.

If any category decreases, fix or revert before starting the next micro-change.
Do not stack a compensating patch on top.

## Focused checks

Use the narrowest relevant test before the full suite. Current useful checks
include:

```bash
python tests/css_layout.py
python tests/header_responsive.py
python tests/chopper_ui.py
python tests/chopper_sampler_layout.py
python tests/drum_ui.py
python tests/css_health.py
python tests/css_redundancy.py
python tests/http_smoke.py
python tests/browser_smoke.py
```

The target architecture also requires a dedicated ownership guard such as:

```text
tests/css_ownership.py
```

That guard must prevent component selectors from drifting back into multiple
owner files and must keep any temporary legacy `!important` whitelist shrinking.

## Runtime-manifest rule

`index.html` is the runtime CSS manifest.

The migration must reach a state where:

- every maintained runtime stylesheet is declared explicitly there;
- application JavaScript injects no stylesheet;
- tests discover/analyze the complete real runtime stylesheet set;
- dead/orphan runtime CSS files are rejected;
- documentation and tests agree with the browser about which CSS files exist.

Until that target is reached, any change to the runtime CSS set must also update
the tests that model it. A browser/test manifest mismatch is itself a failing
architecture condition.

## Ownership rules

### Shared primitives

Generic primitives such as `.btn`, `.panel`, form controls and tabs should have one
shared implementation. Domain styling should prefer consumed custom properties
when the primitive is truly shared rather than redefining the same primitive later
with a more specific selector.

### Domain files

- Looper selectors belong to `looper.css`.
- Chopper chassis/sample display/pads belong to `chopper-sampler.css`.
- Sequence/chop-grid/bar-page selectors belong to `chopper-sequence.css`.
- Drum editor/pattern/FX selectors belong to `chopper-drums.css`.
- Responsive rules live beside their component in the same owner file.

Do not create separate mobile, override, fix, polish, compatibility or versioned UI
stylesheets.

## Specificity discipline

Do not solve a conflict by adding:

- another parent ID;
- another class to a selector chain;
- another later stylesheet;
- another duplicate media rule;
- a new `!important`.

Resolve the ownership problem instead: move or delete the losing declaration so
only the intended owner remains.

Existing `!important` declarations are migration debt. A temporary legacy
whitelist may be used to make progress measurable, but it may only shrink and must
never grow to make a change pass.

## Dead-code discipline

- Prefer deletion over another specificity layer.
- Do not use `display:none` as a substitute for deleting a retired component path.
- Do not keep responsive selectors for a component that no longer exists.
- Do not keep a retired stylesheet as an empty/forwarding compatibility file.
- Do not leave the old declaration behind when moving a rule to its owner.
- Do not optimize physical line count; readable formatting is not debt.

`tests/dead_code.py`, CSS health and redundancy checks must remain hard gates.

## Baseline and score

The audited `230826` CSS architecture baseline is **41 / 100**. The six categories
and their exact starting values are recorded in
`docs/CSS_TARGET_ARCHITECTURE.md`.

The score is a migration safety tool, not a visual-quality score. Every accepted
micro-change must be monotonic:

```text
category_after >= category_before
and
total_after >= total_before
```

A responsive, accessibility, visual or product-behavior regression is considered
a score decrease even if the CSS became shorter or selector count fell.

## Current baseline failure

At the audited baseline, the maintained GitHub Actions run passes the runtime,
JavaScript, audio and SP1200 checks that precede CSS health, then fails in
`tests/css_health.py` because `base.css` still contains unreachable selector paths,
including `.stableTop`, `.utilityBtn` and `.headerActions` variants.

The first runtime cleanup phase must make that baseline truthful and green before
moving broad component ownership. Do not use migration work to hide or bypass the
failure.

## Maintenance goal

The desired end state is not a perfectly flat stylesheet and not one giant file.
It is a small set of human-editable component owners where a maintainer can answer
"where do I change this?" without searching several later override layers, and
where every accepted change proves it did not make any measured category worse.
