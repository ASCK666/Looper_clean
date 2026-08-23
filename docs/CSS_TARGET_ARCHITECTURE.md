# CSS target architecture — no cascade debt

Status: target contract for the `230826` cleanup. This document describes the
architecture to reach; it does not claim the current runtime already satisfies it.

## Objective

Keep the UI easy to edit by a human while making CSS changes local, testable and
reversible.

Non-negotiable goals:

- no dead runtime CSS;
- no compatibility / polish / override stylesheet;
- no stylesheet injected by JavaScript to win load order;
- no component whose final appearance depends on another component stylesheet
  loading later;
- no new `!important` used to win an ownership conflict;
- responsive rules live with the component they modify;
- every runtime stylesheet has one explicit responsibility;
- one micro-change at a time, with focused tests and the full maintained suite;
- every change is self-audited before the next change starts;
- the architecture score is monotonic: no category and no global score may go
  down after an accepted change.

The goal is **not** one giant stylesheet. The goal is a small set of stylesheet
owners that do not correct each other.

## Current-state audit baseline — branch `230826`

Observed runtime on the audited branch:

1. `index.html` loads:
   - `css/base.css`;
   - `css/clean-ui.css`;
   - `css/chopper-drum-controls.css`.
2. `js/bootstrap.js` then injects `css/chopper-deck-texture.css` dynamically and
   explicitly relies on it loading late enough to win the cascade.
3. `docs/CSS_WORKFLOW.md` still describes a two-file runtime.
4. `tests/css_health.py` and `tests/css_redundancy.py` currently analyze only
   `base.css` + `clean-ui.css`, so their model is not the complete browser
   cascade.
5. The current CI run reaches `tests/css_health.py` after all preceding runtime,
   audio and SP1200 checks pass, then fails on unreachable selectors in
   `base.css`, including `.stableTop`, `.utilityBtn` and `.headerActions` paths.
6. Chopper layout/material selectors are currently spread across
   `base.css`, `clean-ui.css`, `chopper-drum-controls.css` and
   `chopper-deck-texture.css`, with repeated `!important` overrides.

This baseline is architectural, not a score of the product's visual quality.

### Baseline score: **41 / 100**

| Category | Weight | Baseline | Reason |
| --- | ---: | ---: | --- |
| Runtime manifest truthfulness | 15 | 5 | documented/tested CSS set differs from the browser set; one CSS is injected dynamically |
| Dead code / redundancy | 15 | 6 | explicit dead-selector failure exists; partial redundancy guards already exist |
| Ownership / locality | 20 | 7 | Looper/Chopper concerns overlap across several runtime stylesheets |
| Cascade independence | 20 | 3 | late overrides, dynamic late CSS and widespread `!important` remain |
| Human editability | 15 | 9 | component names exist, but a maintainer must search several files to know which rule wins |
| Regression safety | 15 | 11 | broad maintained suite exists, but CSS guards do not yet cover the real complete cascade and CI is red |
| **Total** | **100** | **41** | |

### Monotonic score rule

After every accepted micro-change:

- rescore all six categories;
- record `before -> after` and the delta;
- **no category may decrease**;
- **the global score may not decrease**;
- a visual, responsive, accessibility or behavior regression counts as a score
  decrease even if selector count or line count improved;
- if any category decreases, revert or correct that micro-change before doing the
  next one.

Do not game the score by minifying CSS, renaming selectors, hiding DOM, weakening
tests or moving declarations without reducing a real ownership/cascade problem.

## Target runtime CSS layout

Maximum target: six maintained runtime stylesheets.

```text
css/
├── tokens.css
├── shared.css
├── looper.css
├── chopper-sampler.css
├── chopper-sequence.css
└── chopper-drums.css
```

Fewer files are acceptable when ownership stays clearer. More files require an
explicit architecture reason; do not split files merely to reduce line count.

### `tokens.css`

Owns only design tokens and shared constants:

- colors;
- typography variables;
- shared spacing / radius variables when truly reused;
- asset URL tokens such as the deck texture.

It must not contain component selectors or layout.

### `shared.css`

Owns only primitives genuinely reused by more than one product domain:

- box sizing / document shell;
- generic accessibility/focus behavior;
- `.hidden`;
- generic `.panel`, `.btn`, form controls and tab primitives when they are truly
  shared.

A domain-specific look should preferably override a consumed custom property, not
redefine the shared primitive later with a more specific selector.

### `looper.css`

Owns only Looper UI:

- Looper shell/workspace;
- cassette mechanism;
- beat crate;
- Looper pitch and transport;
- Looper-only responsive rules.

It must not style Chopper or Drum components.

### `chopper-sampler.css`

Owns the physical/sample workstation surface:

- Chopper deck/chassis/material;
- sample display and waveform shell;
- sample pitch/tempo/volume/SP controls;
- pads and pad states;
- sample transport;
- sampler-only responsive rules.

It must not own sequence-grid or drum-editor rules.

### `chopper-sequence.css`

Owns the sequence/chop arrangement surface:

- sequence header/actions;
- sequence grid / cells / playhead;
- bar-page controls (`1–2` / `3–4`) and future four-bar UI;
- duplicate/copy/clear sequence actions;
- sequence-only responsive rules.

This separation is intentional so future four-bar work can be targeted without
editing sampler or drum CSS.

### `chopper-drums.css`

Owns only Drum UI:

- kick/snare/hat editor lanes;
- velocity/edit states;
- drum toolbar and quick actions;
- drum pattern preview;
- drum FX controls;
- drum-only responsive rules.

It must not style `.samplerDeck`, generic `.panel`, generic `.btn`, sample knobs,
pads or sequence-grid components.

## Ownership rules

### Rule 1 — one selector owner

A component selector has one owning stylesheet. Another stylesheet must not
redeclare it simply because it loads later.

Bad:

```css
/* shared.css */
.btn { ... }

/* chopper-drums.css */
#chopper .btn { ... !important; }
```

Preferred:

```css
/* shared.css */
.btn {
  color: var(--button-text);
  border-color: var(--button-border);
  background: var(--button-bg);
}

/* chopper-sampler.css */
#chopper {
  --button-text: ...;
  --button-border: ...;
  --button-bg: ...;
}
```

Use variables only for a genuine shared primitive. Do not create variables merely
to hide ownership conflicts.

### Rule 2 — no override-layer filenames

Do not create or preserve files whose purpose is to patch previous CSS:

- `overrides.css`;
- `fixes.css`;
- `clean-ui.css`;
- `polish.css`;
- `compat.css`;
- `mobile.css` / `mobile-fixes.css`;
- `v2.css` / `new-ui.css`.

During migration an existing legacy file may temporarily remain, but every
accepted migration step must reduce its responsibility or leave it unchanged;
never add new product rules to it.

### Rule 3 — responsive rules stay beside their component

Do not create a separate responsive layer. Desktop/tablet/mobile behavior for a
component lives in its owner file.

```css
.chopSequenceGrid { ... }

@media (max-width: 760px) {
  .chopSequenceGrid { ... }
}
```

### Rule 4 — no JavaScript stylesheet injection

`index.html` is the runtime CSS manifest. JavaScript must not append a stylesheet
because it needs to win the cascade. Feature JS may change state/classes/data
attributes; styling those states remains in the owning stylesheet.

### Rule 5 — no specificity escalation as a fix

Do not solve an ownership conflict by adding:

- another parent ID;
- another class in the selector chain;
- `!important`;
- a later stylesheet;
- a later duplicate media rule.

Move or delete the losing declaration so the intended owner is the only owner.

### Rule 6 — explicit component classes over DOM accidents

Prefer a stable component class such as `.chopSequenceHeader` over selectors that
depend on `nth-child`, incidental wrappers or deep ancestry. Use `:has()` and
complex state selectors only when the state relationship is inherently relational
and covered by browser tests.

## Test architecture target

The migration must strengthen tests before relying on the new split.

### Required CSS manifest guard

Tests must derive the runtime CSS list from `index.html` (or one shared explicit
manifest consumed by both runtime and tests). They must reject:

- a runtime CSS file not present in the manifest;
- a CSS file injected dynamically by application JavaScript;
- a CSS file in `css/` that is no longer reachable from the runtime;
- documentation that claims a different runtime list.

### Required ownership guard

Add `tests/css_ownership.py` (or equivalent) to reject at least:

- exact component selectors declared in multiple owner files;
- `.looper*` / Looper-owned selectors outside `looper.css`;
- sequence-owned selectors outside `chopper-sequence.css`;
- drum-owned selectors outside `chopper-drums.css`;
- generic shared primitives redefined in a domain file without an explicit
  approved exception;
- new `!important` declarations outside a very small documented legacy whitelist
  while migration is in progress.

The whitelist must only shrink. It must never grow to make a change pass.

### Required redundancy/dead-code guard

`css_health` / `css_redundancy` must operate on the **complete real runtime CSS
set** and continue rejecting:

- unreachable selectors;
- unused custom properties;
- unused keyframes;
- fully shadowed declarations;
- structural selector growth beyond the maintained budget.

### Required visual/regression guard

For every CSS/HTML micro-change:

1. run the most focused component/layout test first;
2. run CSS health, ownership and redundancy guards;
3. exercise desktop/tablet/mobile browser layouts affected by the change;
4. run `git diff --check`;
5. run `python3 tools/test_all.py`;
6. inspect generated screenshots when the affected test provides them;
7. record score `before -> after` before starting the next micro-change.

If a browser test is unavailable locally, the change is not accepted until the
full GitHub Actions run is green.

## Migration roadmap

Each phase is made of micro-changes. Do not combine phases in one large refactor.

### Phase 0 — freeze and repair the baseline

Goal: make current CSS tests truthful and green before moving rules.

1. Record this 41/100 baseline.
2. Remove currently unreachable `base.css` selectors only after verifying the DOM
   path is truly retired.
3. Run focused CSS tests and full suite.
4. Rescore; accept only a non-decreasing result.

No visual redesign in this phase.

### Phase 1 — make the runtime manifest truthful

Goal: one visible source of truth for every runtime stylesheet.

1. Stop dynamically injecting `chopper-deck-texture.css` from `bootstrap.js`.
2. If it still contains live rules, temporarily load it explicitly from
   `index.html` until its rules are moved to their final owner.
3. Make CSS health/redundancy derive and inspect the complete runtime set.
4. Update docs in the same documentation-only step where needed.

Do not merge a step where runtime and tests disagree about the CSS set.

### Phase 2 — install ownership guards

Goal: prevent new debt before moving the existing debt.

1. Add CSS ownership tests.
2. Add an `!important` legacy baseline/whitelist that can only shrink.
3. Add a guard against application-JS stylesheet injection.
4. Add/strengthen browser snapshots or geometry invariants for components about to
   move.

### Phase 3 — extract stable foundations

In separate micro-changes:

1. extract `tokens.css`;
2. extract `shared.css`;
3. extract `looper.css`.

After each extraction, delete the retired declarations from their old location in
the same change. No duplicate compatibility copy.

### Phase 4 — give the sampler one owner

Move Chopper chassis, sample display, knobs, pads and their responsive rules into
`chopper-sampler.css`.

Fold the live material/texture behavior from `chopper-deck-texture.css` into this
owner, then delete the retired texture stylesheet when empty.

### Phase 5 — isolate sequence ownership

Move sequence/chop-grid UI into `chopper-sequence.css` before implementing the
four-bar page feature. This phase must preserve existing two-bar behavior exactly.

### Phase 6 — isolate Drum ownership

Move only Drum editor/pattern/FX rules into `chopper-drums.css`. Remove unrelated
sampler/pad/chassis rules from the current `chopper-drum-controls.css` as their
owners become available.

Delete `chopper-drum-controls.css` when it becomes empty; do not leave a forwarding
or compatibility stylesheet.

### Phase 7 — retire the override layer

Move each remaining live `clean-ui.css` declaration to its actual owner, one
component at a time. Delete the previous declaration in the same change.

Delete `clean-ui.css` when empty.

### Phase 8 — order-independence audit

For the domain stylesheets after `tokens.css`/`shared.css`, verify that reordering
independent domain files does not change computed styles for their own components.
A meaningful order dependency is evidence of leaked ownership and must be fixed.

## Per-change audit record

Every CSS/HTML cleanup commit or PR should include a small table like this:

```text
Change: move sequence header rules to chopper-sequence.css
Scope: sequence only
Behavior change intended: none
Focused tests: PASS
Full suite: PASS
Visual desktop/tablet/mobile: PASS
Dead selectors: 0 -> 0
New !important: 0
Legacy !important: 137 -> 132
Score:
  manifest truthfulness  10 -> 10  (+0)
  dead/redundancy        11 -> 12  (+1)
  ownership/locality     12 -> 13  (+1)
  cascade independence   8  -> 9   (+1)
  human editability      11 -> 12  (+1)
  regression safety      13 -> 13  (+0)
  total                  65 -> 69  (+4)
Decision: ACCEPT
```

A change with any negative category is `REJECT / FIX / REVERT`, even if the total
would otherwise rise.

## Completion criteria

The migration is complete when all are true:

- runtime CSS is explicit in `index.html`;
- no application JavaScript injects stylesheets;
- no runtime override/compat/polish stylesheet remains;
- no dead runtime CSS remains;
- no fully shadowed declarations remain;
- component ownership tests are green;
- the `!important` migration whitelist is empty or limited only to documented
  browser-normalization cases that are not ownership conflicts;
- Looper, sampler, sequence and Drum changes can be targeted in their owner files;
- desktop/tablet/mobile regression tests are green;
- full maintained suite is green;
- final score is greater than or equal to every previously accepted score in every
  category.
