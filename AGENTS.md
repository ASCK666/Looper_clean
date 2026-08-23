# Looper666 contributor instructions

## Product goal

Keep Looper666 fast to understand and fast to use for making a beat. Simplify the
implementation without turning the project into a framework, a generic audio
platform or a collection of abstraction layers.

The architecture source of truth remains:

- `docs/ARCHITECTURE.md` for current ownership;
- `docs/STATE_DEPENDENCY_MAP.md` for current dependencies and deferred debt;
- `docs/TARGET_ARCHITECTURE.md` for the target and non-negotiable constraints;
- `docs/CSS_TARGET_ARCHITECTURE.md` for CSS/HTML ownership, migration order,
  regression gates and the monotonic architecture score.

Read those files before changing JavaScript ownership, shared state, HTML
structure or CSS ownership.

## Authorization boundary

- Treat observations, comparisons and design opinions as feedback, not as
  permission to edit the product.
- Change UI, layout, CSS, HTML, assets or product behavior only when the user
  explicitly asks for that change.
- A request to simplify JavaScript authorizes JavaScript and focused test changes,
  not a visual redesign or an audio-algorithm change.
- When scope is ambiguous, explain the proposed file-level change before editing.

## JavaScript simplification contract

- Preserve the classic-script runtime and its documented load order:
  `bootstrap.js -> core.js -> looper.js -> practice.js -> chopper.js -> drums.js -> events.js`.
- Do not introduce a framework, TypeScript, a state library, dependency injection,
  a service container or a broad render-context object.
- Do not add a JavaScript file or migrate to ES modules merely to make the tree
  appear cleaner.
- Do not move whole families of globals proactively. Move one complete
  responsibility only when the new owner is obvious and the nearby data flow is
  easier to explain.
- Do not add setters, wrappers, facades or helper objects that merely hide a global
  read or assignment. A delegated operation must own a complete transition.
- Keep `events.js` as wiring: translate a DOM event into one domain call. Reduce
  direct product-state writes when a complete transition can move to its owner.
- Keep Core limited to shared runtime/audio infrastructure. Keep Looper, Chopper
  and Drums behavior with their respective domains.
- Preserve real product coupling such as Drum generation reacting to the loaded
  sample. Make a dependency explicit only when doing so closes a useful boundary.
- Keep Practice frozen unless Practice work is explicitly requested.
- Remove the retired implementation path in the same change; do not leave a
  compatibility layer behind.

## CSS / HTML simplification contract

- Treat `index.html` as the explicit runtime CSS manifest. Application JavaScript
  must not inject a stylesheet to win load order or specificity.
- Target the responsibility split documented in
  `docs/CSS_TARGET_ARCHITECTURE.md`: tokens, shared primitives, Looper, Chopper
  sampler, Chopper sequence and Chopper Drums.
- A component selector has one owning stylesheet. Do not fix a rule by adding a
  later override in another file.
- Do not create or extend `override`, `fix`, `polish`, `compat`, versioned UI or
  separate mobile stylesheets. Responsive rules stay beside the component they
  modify.
- Prefer deleting/replacing the losing declaration over escalating selector
  specificity.
- Do not introduce a new `!important` to resolve an ownership conflict. Any
  temporary legacy whitelist used during migration may only shrink.
- Do not use `display:none` as a substitute for deleting a retired component path.
- Remove retired declarations/selectors/files in the same micro-change that
  replaces them; do not leave compatibility CSS behind.
- Keep semantic/stable component classes explicit enough that a maintainer can
  find a component's styling without relying on `nth-child` or incidental DOM
  ancestry.
- CSS health, redundancy and ownership tests must inspect the complete real
  runtime stylesheet set, not a hand-picked subset.
- Do not optimize line count or file count by themselves. The target is local
  ownership and safe human editing, not minification.

## Small-change gate

Every simplification PR must answer all of these questions before editing:

1. Which single ownership or dependency problem is being removed?
2. Which domain owns the responsibility before and after?
3. Which direct cross-domain read, write, CSS override or workflow becomes
   simpler?
4. Why is the result easier for a maintainer to follow locally?
5. How will unchanged user-visible and audio behavior be verified?
6. Which focused test protects this exact boundary?
7. What is the architecture score before the change, and what is it after?

Reject or split the change when those answers are unclear. Do not optimize line
count, function count or file count by themselves.

## Monotonic score gate

For CSS/HTML cleanup, use the six-category scorecard in
`docs/CSS_TARGET_ARCHITECTURE.md`.

- Start from the recorded branch baseline before the first runtime cleanup.
- After every micro-change, rescore all categories and record `before -> after`.
- No individual category may decrease.
- The total score may not decrease.
- A visual, responsive, accessibility or behavior regression is a score decrease
  even when dead code or selector count improved.
- Do not weaken tests, hide DOM, minify code or grow a whitelist to manufacture a
  higher score.
- If any category decreases, fix or revert that micro-change before starting the
  next one.

## Required workflow

1. Start from the requested branch/current target and inspect the working tree.
   Preserve unrelated work.
2. Run `python3 tools/test_all.py` before the first runtime change. If the baseline
   is red, identify and record the exact failing maintained gate before editing;
   repair that baseline as its own micro-change when it is in scope.
3. Record the current architecture score before the micro-change.
4. Change one complete responsibility. Do not mix ownership, design and audio
   work.
5. Add or strengthen the smallest behavioral/regression invariant that protects
   the changed boundary.
6. Run the focused test for the changed component first.
7. For CSS/HTML changes, run CSS health/redundancy/ownership guards and affected
   desktop/tablet/mobile browser checks before the full suite.
8. Run `git diff --check` and `python3 tools/test_all.py` after the change.
9. Self-audit the diff for dead code, retired paths, duplicate ownership, new
   specificity escalation and unintended visual/behavior changes.
10. Rescore every architecture category. Accept only a non-decreasing result.
11. If local browser tests are skipped, require the full GitHub Actions browser run
    to pass before merge/acceptance.
12. Publish a small PR/commit whose description states the ownership problem,
    affected files, dependency/cascade reduction, validation performed and score
    delta.
13. Keep documentation-only updates separate from runtime ownership changes.

## Stop conditions

Stop and reassess instead of continuing mechanically when:

- the next step would only move code without reducing or clarifying a dependency;
- a proposed API is longer or more abstract than the hidden relationship it replaces;
- a CSS move would leave the old declaration active as a compatibility copy;
- a CSS fix requires a new late stylesheet, more specificity or a new
  `!important` to win;
- the change requires touching UI or audio behavior outside the explicit request;
- the target owner is disputed or the state has more than one writer;
- a focused or maintained test regresses;
- any architecture score category decreases;
- maintained tests are failing for an unrelated reason that makes the change
  impossible to validate safely;
- the PR can no longer be summarized as one responsibility.

After each merged ownership change, re-read `docs/STATE_DEPENDENCY_MAP.md` and,
for CSS/HTML work, `docs/CSS_TARGET_ARCHITECTURE.md`. Broad architecture cleanup
is not a standing queue: continue only with another narrow, explicitly approved
simplification.
