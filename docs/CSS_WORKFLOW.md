# CSS workflow — current runtime and migration discipline

This document describes the **current browser reality** on branch `230826` and the
safe workflow for moving toward `docs/CSS_TARGET_ARCHITECTURE.md`.

The current state is transitional debt, not the target architecture. Accepted
micro-changes and score deltas are recorded in `docs/CSS_MIGRATION_LOG.md`.

## Current runtime truth

`index.html` is now the explicit runtime CSS manifest and currently loads these
stylesheets in this order:

```text
css/base.css
css/clean-ui.css
css/chopper-drum-controls.css
css/chopper-deck-texture.css
```

Application JavaScript no longer injects `chopper-deck-texture.css` or any other
stylesheet to win load order. The four-file layout above remains transitional:
the files still overlap in responsibility and later layers still override earlier
ones.

`tests/css_health.py` and `tests/css_redundancy.py` now derive their runtime CSS
set from the local `<link rel="stylesheet">` entries in `index.html`, in browser
order. They no longer keep a separate hand-written production CSS list.

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
   `docs/CSS_MIGRATION_LOG.md` and `docs/CSS_TARGET_ARCHITECTURE.md`.
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

Current P1 guarantees:

- every maintained runtime stylesheet is declared explicitly in `index.html`;
- application JavaScript injects no stylesheet;
- CSS health and redundancy checks discover/analyze the real runtime stylesheet
  set from `index.html`;
- missing and duplicate local runtime stylesheet entries are rejected;
- dead/orphan runtime CSS files remain covered by the existing dead-code/runtime
  dependency checks.

Any future change to the runtime CSS set must update `index.html`; the health and
redundancy tests follow that manifest automatically.

Some older inline browser fixtures still embed a historical subset of the CSS
cascade. P1 deliberately preserves their existing minimum guard rather than
rewriting unrelated behavior fixtures. Before owner-level visual equivalence is
used as a migration gate, those relevant fixtures must be migrated to one shared
manifest-driven inlining path or replaced by tests that serve the real page.

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

The historical audit started at **41 / 100**. Immediately before P1, the branch had
already removed several unreachable/shadowed declarations; the operational B0 was
therefore re-frozen at commit `39854c695f2c732fb12d9e011e127feadd10c790` as
**44 / 100**.

P1 completes at **54 / 100**, with no category decrease. Exact per-commit scoring
and validation evidence live in `docs/CSS_MIGRATION_LOG.md`.

The score is a migration safety tool, not a visual-quality score. Every accepted
micro-change must be monotonic:

```text
category_after >= category_before
and
total_after >= total_before
```

A responsive, accessibility, visual or product-behavior regression is considered
a score decrease even if the CSS became shorter or selector count fell.

## Current truthful CSS gates after P1

P1 intentionally does **not** make the CSS clean; it makes the tests describe the
real runtime before P2 starts.

The current full-runtime CSS model reports:

```text
selector branches: 775 / 750  -> FAIL
unused custom properties:
  --sampler-shell
  --chopper-amber-hot
  --chopper-surface-hi
```

The selector budget remains 750. Do not raise it to make CI green. The unused
variables and enough real selector/redundancy debt must be removed in P2 so the
truthful gates pass naturally.

Maintained runtime, JavaScript, audio, SP1200 and regression checks that execute
before CSS health continue to pass in P1 runs. The current CI failure is therefore
a known architecture gate exposed by complete CSS accounting, not a reason to
weaken the test.

## Maintenance goal

The desired end state is not a perfectly flat stylesheet and not one giant file.
It is a small set of human-editable component owners where a maintainer can answer
"where do I change this?" without searching several later override layers, and
where every accepted change proves it did not make any measured category worse.
