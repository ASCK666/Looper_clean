# CSS workflow — current runtime and migration discipline

This document describes the **current browser reality** on branch `230826` and the
safe workflow for moving toward `docs/CSS_TARGET_ARCHITECTURE.md`.

Accepted migration changes and score deltas are recorded in
`docs/CSS_MIGRATION_LOG.md`.

## Current runtime truth

`index.html` is the single runtime CSS manifest. After P3 it loads, in order:

```text
css/tokens.css
css/shared.css
css/base.css
css/looper.css
css/clean-ui.css
css/chopper-drum-controls.css
css/chopper-deck-texture.css
```

Application JavaScript injects no stylesheet. `tests/css_health.py` and
`tests/css_redundancy.py` derive the runtime set from the local stylesheet links in
`index.html`; they do not maintain a separate production list.

`base.css`, `clean-ui.css`, `chopper-drum-controls.css` and
`chopper-deck-texture.css` are still transitional. In particular,
`clean-ui.css` is a retiring legacy override layer: **it may only stay unchanged or
shrink. It must not receive new product behavior.**

## Established P3 owners

P3 established three target owners:

```text
css/tokens.css  -> global tokens only
css/shared.css  -> shared primitives / cross-domain structure
css/looper.css  -> Looper-only layout, skin, interaction and responsive behavior
```

The remaining target owners are:

```text
css/chopper-sampler.css
css/chopper-sequence.css
css/chopper-drums.css
```

The governing rule remains:

> A component has one CSS owner. Another stylesheet must not correct it later in
> the cascade.

Responsive rules live with the component owner. Do not create separate mobile,
override, fix, polish, compatibility or versioned UI stylesheets.

## Validation cadence

Do **not** treat every CSS edit as a release candidate. Use three levels.

### DEV — after each micro-change

Run only the narrowest checks for the modified owner. Typical CSS checks are:

```bash
python tests/css_health.py
python tests/css_redundancy.py
python tests/css_layout.py
python tests/browser_smoke.py
```

Use Chopper-specific browser tests only when Chopper CSS changed, and Looper
render/layout tests only when Looper CSS changed. Do not rerun SP1200 DSP/audio
browser suites for an unrelated small CSS move.

### FAST — at an ownership checkpoint

Run static/unit checks plus the smoke/layout tests affected by the accumulated
changes. Until a dedicated fast runner exists, select these commands explicitly;
do not hide a second test manifest in another script.

### FULL — end of phase / before merge

Run once after the whole coherent lot is ready:

```bash
python3 tools/test_all.py
```

A failed FULL is fixed at its first relevant failure, then rerun only after the
fix. Do not run FULL after every micro-change.

## Safe micro-change loop

1. State one ownership/cascade problem.
2. Record the architecture score before the change.
3. Identify the intended owner and the narrowest affected check.
4. Move or edit the smallest coherent rule set.
5. Delete retired source declarations in the **same change**.
6. Run DEV checks.
7. Audit for duplicate ownership, specificity escalation and new `!important`.
8. Use FAST at a checkpoint and FULL once at phase completion.
9. Rescore every category; no category and no total may decrease.

If a regression appears, fix the owner or revert. Do not stack a compensating
late override.

## Runtime-manifest rule

Any change to the runtime CSS set must update `index.html`. Runtime-aware tests
should derive the list from that manifest or serve the real page. Do not add
another hand-written global runtime CSS list.

Manifest-driven inline fixtures may share `tests/browser_fixture.py`; tests that
can serve the real application should prefer that. Do not grow a second fixture
framework around this helper.

`tests/chopper_runtime_css.py` deliberately does **not** freeze the global
stylesheet count or the complete ordered manifest. It serves the real page,
requires every declared stylesheet link it observes to be loaded without
duplication, verifies the current Chopper owners exactly once and in their required
relative order, then asserts Chopper geometry/material behavior across the four
maintained viewports. A legitimate unrelated extraction may therefore add another
runtime stylesheet without breaking the Chopper gate merely because the global
file count changed.

## Specificity discipline

Do not solve a conflict by adding:

- another parent ID;
- another class to a selector chain;
- another later stylesheet;
- another duplicate media rule;
- a new `!important`.

Existing `!important` declarations are migration debt. They may move with their
owner during a behavior-preserving extraction, but ownership work must not create
new ones merely to win cascade order.

## Dead-code discipline

- Prefer deletion over another specificity layer.
- Do not keep the old declaration after moving it to its owner.
- Do not keep retired responsive selectors.
- Do not keep an empty/forwarding compatibility stylesheet.
- Do not use `display:none` as a substitute for deleting a retired component path.
- Do not optimize physical line count; readable formatting is not debt.

`tests/dead_code.py`, CSS health and redundancy remain hard gates.

## Current P3 completion state

The P3 runtime extraction was fully validated on commit
`8d941cd1a61c7ea06f24fd021b10c13459da018b` (run #186):

```text
runtime stylesheets: 7
selector branches: 749 / 750
unreachable selector branches: 0
unused keyframes: 0
fully-shadowed declarations: 0
ALL PROJECT CHECKS PASSED
```

The final manifest-test decoupling commit
`da353194c968efbb41e95c13f728e43638f0a431` also passed the complete project
workflow (run #188). It changed no production CSS or runtime behavior.

Architecture score at P3 completion: **75 / 100**. The score is a migration
safety measure, not a visual-quality score; exact category deltas are recorded in
`docs/CSS_MIGRATION_LOG.md`.

## Maintenance goal

The desired end state is a small set of human-editable component owners where a
maintainer can answer “where do I change this?” without searching through later
override layers. `clean-ui.css` disappears once its remaining responsibilities
have moved to real owners.
