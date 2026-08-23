# CSS / HTML migration log — branch `230826`

This file records accepted migration micro-changes and their architecture score.
It is an audit log, not a product changelog.

Rules:

- score every accepted micro-change;
- no category may decrease;
- total score may not decrease;
- do not raise a budget, weaken a test, hide DOM or grow an exception list to make
  a change appear better;
- a newly visible failure caused by broader truthful analysis is recorded as
  pre-existing debt when the runtime itself did not change in that dimension;
- runtime/declaration cleanup exposed by a phase belongs to the next relevant
  phase instead of being mixed into the current one.

## Score categories

| Category | Max |
| --- | ---: |
| Runtime manifest truthfulness | 15 |
| Dead code / redundancy | 15 |
| Ownership / locality | 20 |
| Cascade independence | 20 |
| Human editability | 15 |
| Regression safety | 15 |
| **Total** | **100** |

## B0 — operational baseline before P1

Reference commit: `39854c695f2c732fb12d9e011e127feadd10c790`

This replaces the older historical 41/100 audit as the operational baseline for
runtime migration. The branch had already removed the previously reported
unreachable selectors / fully-shadowed declarations before P1 started.

| Category | B0 |
| --- | ---: |
| Runtime manifest truthfulness | 5 / 15 |
| Dead code / redundancy | 9 / 15 |
| Ownership / locality | 7 / 20 |
| Cascade independence | 3 / 20 |
| Human editability | 9 / 15 |
| Regression safety | 11 / 15 |
| **Total** | **44 / 100** |

Observed B0 gates:

- runtime, JavaScript, audio, SP1200 and regression gates before CSS checks: PASS;
- `css_health.py`: PASS on its then-incomplete two-file model, 598/750 selector
  branches, zero unreachable selector branches;
- `css_redundancy.py`: FAIL on unused `--sampler-shell`;
- browser runtime actually had four CSS layers, while health/redundancy only
  inspected `base.css` + `clean-ui.css`;
- `bootstrap.js` dynamically injected `chopper-deck-texture.css` to win late load
  order.

## P1 — make the runtime CSS manifest truthful

P1 intentionally changes **no CSS declaration value and no HTML component
structure**. Its only runtime behavior change is how an existing stylesheet is
declared/loaded; its final cascade order remains after `chopper-drum-controls.css`.

### P1.1 — declare texture CSS in `index.html`

Commit: `6a0100399d6781463f8be30eadcfc3d47a01f141`

Change:

- added explicit `chopper-deck-texture.css` link to the HTML manifest;
- kept the existing data marker so the old bootstrap injection became inert rather
  than producing a duplicate stylesheet.

Validation:

- all maintained gates before CSS redundancy: same PASS profile as B0;
- CSS failure remained the same pre-existing `--sampler-shell` redundancy debt;
- no CSS declarations changed.

Score: **44 -> 47 (+3)**

| Category | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Runtime manifest truthfulness | 5 | 8 | +3 |
| Dead code / redundancy | 9 | 9 | 0 |
| Ownership / locality | 7 | 7 | 0 |
| Cascade independence | 3 | 3 | 0 |
| Human editability | 9 | 9 | 0 |
| Regression safety | 11 | 11 | 0 |

### P1.2 — remove stylesheet injection from `bootstrap.js`

Commit: `3790548de8d22e61c9a2cf466cdeb10484018c4b`

Change:

- removed the dead JavaScript path that created a `<link>` at runtime;
- application JavaScript no longer injects CSS for load-order precedence.

Validation:

- all maintained gates before CSS redundancy: same PASS profile as B0/P1.1;
- same pre-existing `--sampler-shell` failure;
- no CSS declarations changed.

Score: **47 -> 50 (+3)**

| Category | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Runtime manifest truthfulness | 8 | 9 | +1 |
| Dead code / redundancy | 9 | 9 | 0 |
| Ownership / locality | 7 | 7 | 0 |
| Cascade independence | 3 | 5 | +2 |
| Human editability | 9 | 9 | 0 |
| Regression safety | 11 | 11 | 0 |

### P1.3 — derive redundancy analysis from the HTML manifest

Commit: `6daf306f01bd15f7eaba7f9635f2e7e34a25759b`

Change:

- `css_redundancy.py` no longer hard-codes two CSS files;
- it discovers local runtime stylesheets from `index.html` in browser order;
- missing or duplicate stylesheet entries are rejected.

Validation/result:

- no production file changed;
- all product/runtime gates before CSS checks remained PASS;
- the broader truthful analysis exposed three pre-existing unused variables:
  `--sampler-shell`, `--chopper-amber-hot`, `--chopper-surface-hi`.

Those variables are P2 dead/redundancy debt. They are not deleted in P1.

Score: **50 -> 52 (+2)**

| Category | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Runtime manifest truthfulness | 9 | 9 | 0 |
| Dead code / redundancy | 9 | 9 | 0 |
| Ownership / locality | 7 | 7 | 0 |
| Cascade independence | 5 | 5 | 0 |
| Human editability | 9 | 9 | 0 |
| Regression safety | 11 | 13 | +2 |

### P1.4 — derive CSS health analysis from the HTML manifest

Commits:

- `e86e44c09a54d4fd24f57874295f721941423e39` — first strict fixture attempt;
- `e6e934405d47a147df462ebc89988854a5ec19e4` — keep P1 focused on production
  manifest truth while preserving the pre-existing inline-fixture guard.

Change:

- `css_health.py` discovers the complete local CSS runtime from `index.html`;
- selector/dead-branch accounting now covers all four runtime stylesheets;
- the existing inline-fixture safety invariant (`base.css` implies
  `clean-ui.css`) remains intact; migrating every behavioral fixture to a shared
  full-manifest inliner is deliberately deferred to the regression-safety phase
  instead of expanding P1 into unrelated test rewrites.

Validation/result:

- no production file changed in P1.3/P1.4;
- all product/runtime gates before CSS health remained PASS;
- complete runtime CSS health now truthfully reports **775 selector branches**;
- the existing structural budget remains **750**;
- the gate therefore fails `775 > 750`.

The budget was **not increased**. P2 must reduce real selector/dead/redundancy debt
rather than weakening the guard.

Score: **52 -> 53 (+1)**

| Category | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Runtime manifest truthfulness | 9 | 9 | 0 |
| Dead code / redundancy | 9 | 9 | 0 |
| Ownership / locality | 7 | 7 | 0 |
| Cascade independence | 5 | 5 | 0 |
| Human editability | 9 | 9 | 0 |
| Regression safety | 13 | 14 | +1 |

## P1 completion state

After documentation is synchronized with the runtime, P1 target score is:

| Category | P1 complete |
| --- | ---: |
| Runtime manifest truthfulness | 10 / 15 |
| Dead code / redundancy | 9 / 15 |
| Ownership / locality | 7 / 20 |
| Cascade independence | 5 / 20 |
| Human editability | 9 / 15 |
| Regression safety | 14 / 15 |
| **Total** | **54 / 100** |

Net P1 delta: **44 -> 54 (+10)**.

No category decreased.

### Known debt handed to P2

P1 must not hide these findings:

1. real runtime CSS selector branches: **775 / 750**;
2. unused custom properties exposed by the full runtime cascade:
   - `--sampler-shell`;
   - `--chopper-amber-hot`;
   - `--chopper-surface-hi`;
3. the four current CSS files still overlap in responsibility and remain
   transitional architecture;
4. existing `!important` / cross-file ownership debt is not addressed by P1;
5. some inline browser fixtures still intentionally carry the historical partial
   CSS embedding pattern; they must be migrated/strengthened before relying on
   them for owner-level visual equivalence.

P2 begins only after this state is accepted. It must remove real dead/redundant
CSS and bring the truthful selector count back under the existing budget without
raising that budget.
