# SP1200 correction progress

Branch: `correct-SP1200`
Baseline runtime commit: `8f9afac574bb8f201548f9f97139df33f8fd45da`
Baseline audit: `docs/SP1200_CORRECTION_AUDIT_BASELINE.md`

## Current accepted scores

Current accepted audit state: C4
Last runtime/test/validation HEAD audited: `b36ea11d1c3ca7580c344a80bf10cbce8657d65e`
Current documentation HEAD: this file may be one commit ahead of the runtime/test HEAD because rescoring is committed separately.
Current merge verdict: **SP1200 correction accepted through B6 and D4; full-project PR remains draft/not mergeable** — the maintained suite executes and passes all SP1200 unit/browser/race gates plus the dedicated PUNCH pending-preview regression, then stops later in unrelated `tests/regression_v63.py` while waiting for `#practiceOverlayOpen`. Practice remains frozen and out of scope for this correction.

| Area | Current score |
| --- | ---: |
| SP DSP | **8.3 / 10** |
| `renderSpChop()` / PAD-PLAY boundary | **7.8 / 10** |
| Claimable SP fidelity | **6.5 / 10** |
| Async / race handling | **8.2 / 10** |
| Ownership / architecture | **7.2 / 10** |
| DSP tests | **7.5 / 10** |
| Integration tests | **7.0 / 10** |
| Overall maintainability | **6.7 / 10** |
| **Total feature** | **7.1 / 10** |

These scores use the same rubric as the immutable baseline. No score is raised solely because a correction was authored on this branch. B1-B6 and D4 are now closed at the accepted SP1200 correction level. Duplicate Drum invalidations and classic-script/global debt continue to cap architecture and maintainability. The remaining full-suite blocker is outside the SP1200 lifecycle and does not downgrade the validated SP1200 categories.

## C1 — maintained PLAY race contract

Runtime/test commit: `e69019ce9d540ab8b25bccd097ec3a37d29313cc`
Finding addressed: **B1 — maintained race test incompatible with current PLAY implementation**.

### Change

Only `tests/sp1200_races.py` changed.

The obsolete source-contract assertion requiring:

```python
const generation=++previewRenderGeneration
```

was replaced by an ownership contract requiring PLAY to obtain its generation through:

```js
const generation=invalidatePreviewRender();
```

and explicitly rejecting a direct `++previewRenderGeneration` inside `playCurrentBeat()`.

### Pre-push impact audit

Expected impact before commit:

- SP DSP: no code path touched;
- `renderSpChop()`: no code path touched;
- SP fidelity: unchanged;
- async/race runtime behavior: unchanged;
- renderer ownership runtime: unchanged;
- integration tests: maintained source contract becomes consistent with current renderer owner;
- transport, PAD, PLAY, SAVE, STOP, Banks, SLICES, Drums, PUNCH, VINYL: no runtime code touched;
- script order and wrappers: unchanged;
- mobile/performance: unchanged;
- new runtime dependency/abstraction/writer: none.

No baseline category was expected to decrease, so the test-only correction was accepted for commit.

### Post-commit audit

Diff from the previous accepted commit:

- files changed: 1;
- `tests/sp1200_races.py`: +2 / -1;
- runtime JavaScript changed: 0 files;
- DSP changed: 0 files.

The new maintained source contract matches current `events.js`, where `playCurrentBeat()` uses `invalidatePreviewRender()`, still rechecks the generation after async boundaries, and passes the generation into `playRendered()`.

The obsolete direct-increment contract is now explicitly forbidden inside `playCurrentBeat()`.

### Scores after C1

| Area | Baseline | After C1 | Verdict |
| --- | ---: | ---: | --- |
| SP DSP | 8.3 | 8.3 | unchanged |
| `renderSpChop()` / PAD-PLAY boundary | 7.8 | 7.8 | unchanged |
| Claimable SP fidelity | 6.5 | 6.5 | unchanged |
| Async / race handling | 4.5 | 4.5 | unchanged; no runtime race fixed yet |
| Ownership / architecture | 5.0 | 5.0 | unchanged; test now reflects existing owner |
| DSP tests | 7.5 | 7.5 | unchanged |
| Integration tests | 4.0 | 4.2 | small improvement: one contradictory maintained gate removed |
| Overall maintainability | 5.5 | 5.5 | unchanged |
| **Total feature** | **5.8** | **5.8** | unchanged; major lifecycle blockers remain |

### Validation limits

GitHub currently publishes no status checks for commit `e69019ce9d540ab8b25bccd097ec3a37d29313cc`. Therefore this audit does **not** claim that the full project suite or Chromium tests passed.

This correction resolves only B1. It does not resolve the pending-render races in Banks, SLICES, VINYL, SP mode changes, sample loading, or the behavioral contract of the existing marker race regression.

## C2 — single-owner pending preview invalidation

Accepted runtime/test commits:

- `7eb7e343c6e9f5981b783d68218e4cf9c55ae611` — SP mode/output invalidation routed through renderer owner;
- `596830d8dbfaaafbb879082dea423f73e73aa159` — renderer internals use `invalidatePreviewRender()` as the generation writer;
- `091c7d5aff30c166d2185297ca5d453d1348a978` and `d3fd07c76bcc25ea7707f5f966cb18da03a7eb1f` — source-contract ownership guards;
- `c6b0d0968d6773ae051dd803d15a778bdd38b799` — Banks invalidate pending preview before bank state changes;
- `fa7ae2815e8e217c6138630bc104437e243fb763` — SLICES mutations route through the renderer owner;
- `5c7122a0e0daa77b66c2ecc2a1e1564368bb165c` — VINYL invalidates at the first meaningful `input` mutation;
- `8e0a101a686e52bd10f898a243e2f6cfee56a323` — global ownership guard plus SLICES/VINYL pending-PLAY browser regressions.

Findings addressed: **B2, B3, B4 and B5**. The SP ON/OFF and RAW/FILTER pending-render path is also routed through the same renderer owner.

### Runtime contract after C2

`invalidatePreviewRender()` is the single writer of the combined preview generation and owns invalidation of the published preview cache:

```js
function invalidatePreviewRender(){
  previewRenderGeneration++;
  renderedFlip=null;
  return previewRenderGeneration;
}
```

External domains request invalidation through that operation rather than mutating `previewRenderGeneration` or clearing `renderedFlip` directly. The SP PAD audition token remains separate because it owns a different async lifecycle.

BANK changes invalidate before `activeBankIndex` changes when transport is not already active. When an active beat must also stop, `stopCurrentBeat()` performs the renderer invalidation as part of transport shutdown.

SLICES boundary edits, insertions, mode changes and resets request renderer invalidation from the owning mutation operation. The old redundant `pointerup` cache clear was removed.

VINYL now invalidates on `input`; the expensive rerender remains on `change`, avoiding a full render on every slider tick while preventing an older pending render from becoming audible later.

SP ON/OFF and RAW/FILTER changes no longer directly mutate renderer state.

### Rejected changes during C2 audit

The post-write gate rejected and removed commits that contained unrelated churn:

- one SLICES attempt changed an unrelated BPM expression;
- a second SLICES attempt changed only the file's final-newline state;
- a VINYL attempt changed only the file's historical final-newline state.

Those commits are not part of the accepted branch history. The accepted replacements preserve unrelated runtime text.

### Test/audit coverage after C2

`tests/sp1200_races.py` now:

- requires exactly one `previewRenderGeneration++` in `drums.js`, inside `invalidatePreviewRender()`;
- rejects direct generation mutation in every other `js/*.js` runtime file;
- rejects direct `renderedFlip = null` invalidation outside the renderer/state-owner files;
- retains STOP-safe pending PAD and pending PLAY regressions;
- retains the immutable SP render snapshot regression as an internal-mutation contract;
- adds a pending PLAY regression for MARKERS/SLICES mode mutation;
- adds a pending PLAY regression for VINYL `input` mutation.

The final test commit `8e0a101a686e52bd10f898a243e2f6cfee56a323` changes only `tests/sp1200_races.py` (+69 / -8); no runtime or DSP file is changed by that commit.

### Remaining blockers / debt

**B6 remains open.** `loadChopperSample()` invalidates pending preview work, but it does not stop an already-audible combined `flipSource` before replacing the sample context after asynchronous decode. Rapid overlapping sample loads also do not yet have an explicit last-request-wins contract.

**D4 remains open.** PUNCH still has a smaller input/change timing mismatch compared with controls that invalidate at the first meaningful mutation.

Duplicate Drum invalidations and existing classic-script/global ownership debt remain non-blocking maintainability issues. No new renderer/state abstraction was introduced by C2.

### Scores after C2

The same baseline rubric is used; no scoring criterion was changed.

| Area | Baseline | After C1 | After C2 | Verdict |
| --- | ---: | ---: | ---: | --- |
| SP DSP | 8.3 | 8.3 | **8.3** | unchanged; DSP untouched |
| `renderSpChop()` / PAD-PLAY boundary | 7.8 | 7.8 | **7.8** | unchanged; boundary preserved |
| Claimable SP fidelity | 6.5 | 6.5 | **6.5** | unchanged; no new fidelity claim/model |
| Async / race handling | 4.5 | 4.5 | **6.8** | major pending-preview resurrection paths closed; sample-load lifecycle still blocks a higher score |
| Ownership / architecture | 5.0 | 5.0 | **7.2** | combined preview invalidation now has one owner; global classic-script debt remains |
| DSP tests | 7.5 | 7.5 | **7.5** | unchanged |
| Integration tests | 4.0 | 4.2 | **5.6** | stronger global ownership guards plus SLICES/VINYL behavioral races; browser suite not executed and B6 lacks regression coverage |
| Overall maintainability | 5.5 | 5.5 | **6.4** | cross-domain writes reduced and lifecycle intent clearer; existing global/debt remains |
| **Total feature** | **5.8** | **5.8** | **6.6** | materially safer lifecycle, but not merge-ready while B6 remains open |

### Validation limits after C2

GitHub publishes no status checks for HEAD `8e0a101a686e52bd10f898a243e2f6cfee56a323`. The full `tools/test_all.py` suite and Chromium regressions were not executed in this audit environment, so the improved integration-test score reflects maintained coverage and code-level audit, **not** a claim that the browser suite passed.

### C2 verdict

C2 is accepted. No score is below the baseline. B2–B5 are considered closed at code-review level. The correction branch remains **not mergeable** because B6 is still open and full behavioral validation has not been executed.

## C3 — sample replacement lifecycle and maintained validation

Accepted SP1200 runtime/test commits:

- `c5586c470c4586539b1d73a82658f61ac48944a7` — sample loads become last-request-wins and stop/invalidate obsolete combined preview state before a replacement context can publish;
- `e6e028ba9710741037c5b45af857332f80978108` — maintained source contracts plus Chromium regressions for active PLAY replacement, pending PLAY replacement and overlapping decode last-request-wins.

Validation-path corrections required to execute the maintained suite:

- `82f29faabbdac538dd3f96f1d75b5addb6780468` — tracks the already-used production Chopper button artwork in `tests/assets_health.py`;
- `9e88e7e1120f91a1bf91bd4943cf8cef60a88682` — installs Pillow in CI because the maintained Looper66 contract imports `PIL.Image` to verify production artwork dimensions;
- `11af24bbd5e23b737cbca5ca323e0dec8f493c51` plus cleanup `d24448edc82f3de657d1d88c43c05d8822b903f8` — align the stale FILTER source-contract with the existing `filterButton.id="sp1200FilterToggle"` runtime binding while restoring the unrelated historical final-newline state. The cumulative FILTER-test diff from the previous accepted validation HEAD is exactly +1 / -1.

Finding addressed: **B6 — sample replacement lifecycle incomplete**.

### Runtime contract after C3

Sample loading owns a lifecycle token separate from both combined-preview invalidation and SP PAD audition:

- each accepted load allocates a new `sampleLoadGeneration`;
- if a combined PLAY is already audible, sample replacement routes shutdown through `stopCurrentBeat()` before the replacement context is published;
- if PLAY is still rendering, sample replacement calls the renderer-owned `invalidatePreviewRender()` so the old continuation cannot publish/start;
- decoded audio is held in a local value until the generation is rechecked;
- stale decode completions return without publishing `sampleBuffer`;
- stale errors also return without overwriting the newer load's UI/status;
- rapid overlapping loads are explicitly last-request-wins.

No new state manager, renderer abstraction, compatibility layer or cross-domain writer was introduced. The separate tokens remain separate because they own different async lifecycles.

### C3 impact audit

Accepted impact relative to C2:

- SP DSP: unchanged; `js/sp1200.js` untouched;
- `renderSpChop()`: unchanged;
- SP fidelity model/claims: unchanged;
- PAD SP audition generation: unchanged and still local to the adapter;
- combined-preview ownership: unchanged; `invalidatePreviewRender()` remains the single combined-preview generation writer;
- sample replacement: stronger lifecycle only, with one local generation token;
- PLAY/STOP: old active or pending combined previews cannot survive sample replacement;
- BANKS/SLICES/VINYL/SP mode paths: no ownership regression introduced;
- SAVE: no contract change;
- Drums/PUNCH: no runtime change;
- script order: unchanged;
- mobile/performance: no new render layer or continuously-running work;
- dead code: maintained JS health reports no dead declarations.

No scoring category is below C2 or the immutable baseline.

### Maintained regression coverage added for B6

`tests/sp1200_races.py` now maintains three behavioral sample-load regressions in addition to the existing lifecycle tests:

1. an already-audible combined PLAY is stopped before the newly loaded sample becomes the active context;
2. a combined PLAY still rendering is invalidated and cannot resurrect after sample replacement;
3. overlapping sample decodes are last-request-wins even when the older request completes after the newer one.

Cheap source contracts additionally require the separate sample-load generation token, active-preview shutdown, pending-preview invalidation, and stale checks before source publication and obsolete error publication.

### Validation evidence after C3

GitHub Actions run `32628548979` executes the maintained `python tools/test_all.py` chain with Python 3.12, Node 22, Pillow, Playwright and Chromium.

The following gates pass before the unrelated later failure:

- `tests/resource_paths.py`;
- `tests/dead_code.py`;
- `tests/assets_health.py` — 8 production visuals tracked;
- `tests/validate.py`;
- `tests/looper66_contract.py`;
- `tests/js_health.py` — 173 functions, 96 top-level bindings, no dead declarations;
- `tests/core_unit.js`;
- `tests/auto_mix_unit.js`;
- `tests/sp1200_dsp_unit.js`;
- `tests/sp1200_gain_unit.js`;
- `tests/sp1200_output_filter_unit.js`;
- `tests/sp1200_level_dac_unit.js`;
- `tests/sp1200_browser.py` — PAD/PLAY parity, shared reconstruction rate, ON/OFF, BANK/SLICES, VINYL and STOP;
- `tests/sp1200_races.py` — single-owner invalidation plus STOP-safe PAD/PLAY/sample-load lifecycle.

The same maintained suite then fails later in `tests/regression_v63.py` because Playwright times out waiting for `#practiceOverlayOpen`. Therefore C3 does **not** claim that the complete repository suite exits zero. That remaining failure is in frozen Practice behavior and is outside the SP1200 correction scope.

### Scores after C3

The same immutable baseline rubric is retained.

| Area | Baseline | After C2 | After C3 | Verdict |
| --- | ---: | ---: | ---: | --- |
| SP DSP | 8.3 | 8.3 | **8.3** | unchanged; no DSP change |
| `renderSpChop()` / PAD-PLAY boundary | 7.8 | 7.8 | **7.8** | unchanged; boundary preserved |
| Claimable SP fidelity | 6.5 | 6.5 | **6.5** | unchanged; no new hardware claim or model |
| Async / race handling | 4.5 | 6.8 | **8.0** | B6 active/pending replacement races closed and last-request-wins behavior is maintained under Chromium |
| Ownership / architecture | 5.0 | 7.2 | **7.2** | sample token remains local; combined preview owner unchanged; classic-script/global debt remains |
| DSP tests | 7.5 | 7.5 | **7.5** | DSP tests pass; no new DSP scope |
| Integration tests | 4.0 | 5.6 | **6.8** | SP browser and race suites now execute and pass, including B6 regressions |
| Overall maintainability | 5.5 | 6.4 | **6.6** | maintained CI path repaired, stale contracts removed and no dead declarations; existing architectural debt remains |
| **Total feature** | **5.8** | **6.6** | **7.0** | all SP blocking findings B1-B6 closed and behaviorally validated; unrelated Practice suite failure still blocks a full-project green verdict |

### Remaining debt after C3

**D4 remains open and non-blocking.** PUNCH still has the smaller `input`/`change` temporal mismatch identified by the baseline.

Duplicate Drum invalidation paths and classic-script/global ownership remain non-blocking maintainability debt. C3 does not use those debts as justification for a new abstraction.

The full-project draft PR also remains red because `tests/regression_v63.py` expects the frozen Practice control `#practiceOverlayOpen`. That issue is explicitly not treated as an SP1200 regression.

### C3 verdict

C3 is accepted. B6 is closed. B1-B6 are now closed at the SP1200 correction level. The DSP score and fidelity claims are unchanged, `renderSpChop()` remains intact, combined-preview ownership remains single-owner, and the maintained SP1200 unit/browser/race coverage passes under GitHub Actions Chromium.

The SP1200 feature score is **7.0 / 10**, up from **6.6 / 10** at C2 and **5.8 / 10** at baseline. The branch/PR remains draft at the full-project level only because the maintained suite fails later in an unrelated frozen Practice regression.

## C4 — PUNCH input-time preview invalidation

Accepted runtime/test commits:

- `9c79d3fc3c7048a1841a34871115f247b5b7a568` — PUNCH invalidates the combined-preview generation on `input` before refreshing its visual value; the old `change` invalidation is removed so the transition is not duplicated;
- `09d0a0a213333ae93adf1651dd76ed7d9250a405` — adds a focused Chromium regression proving that an input-only PUNCH mutation invalidates a pending full PLAY before release;
- `b36ea11d1c3ca7580c344a80bf10cbce8657d65e` — adds that regression to the maintained runner before the known frozen-Practice gate.

Finding addressed: **D4 — PUNCH input timing**.

### Runtime contract after C4

PUNCH now follows the same temporal split used by the other combined-preview inputs:

- `input` is the first meaningful PUNCH mutation, so it calls `invalidatePreviewRender()` immediately and then refreshes the PUNCH readout;
- `change` remains the commit/release boundary for status text and the expensive rerender of an already-audible preview;
- no additional generation token, writer, helper, wrapper or state abstraction is introduced;
- the old `change` invalidation is removed rather than retained as a duplicate path.

This means a pending combined render started with an older PUNCH preset may finish computation, but its generation is stale before it can publish or start playback. An already-audible preview keeps the existing product behavior: the control can update visually while dragging and rerenders on release.

### C4 impact audit

Accepted impact relative to C3:

- SP DSP: unchanged; no DSP file touched;
- `renderSpChop()`: unchanged;
- SP fidelity model/claims: unchanged;
- combined-preview generation ownership: unchanged; PUNCH still requests invalidation through renderer-owned `invalidatePreviewRender()`;
- PLAY: a pending full PLAY cannot resurrect after a PUNCH `input` mutation;
- active PLAY: audible rerender remains on `change`, so no repeated OfflineAudioContext render is added while dragging;
- SAVE: unchanged and still renders current state rather than preview cache;
- PUNCH audio algorithm/presets: unchanged;
- Banks, MARKERS, SLICES, Drums, VINYL, SP RAW/FILTER/ON-OFF: unchanged;
- script order: unchanged;
- mobile/performance: one cheap generation increment/cache invalidation per range input; no render is added on input;
- dead code: `tests/dead_code.py` and `tests/js_health.py` pass, with JS health still reporting 173 functions, 96 top-level bindings and no dead declarations;
- new runtime abstraction/file: none.

No scoring category decreases from C3 or from the immutable baseline.

### Maintained regression coverage added for D4

`tests/punch_preview_race.py` deliberately dispatches **only** `input`, not `change`, while a full PLAY is pending. It verifies that:

1. PLAY allocates its renderer generation;
2. PUNCH `input` advances that generation exactly once through the renderer owner;
3. the older pending PLAY returns `false` and never reaches `playRendered()`;
4. `renderedFlip` remains invalidated and transport remains stopped;
5. the PUNCH visual readout still updates to the selected preset.

The test is intentionally narrow and uses the real application wiring while replacing only the expensive render/play endpoints with delayed test doubles. It adds no product/runtime code.

### Validation evidence after C4

GitHub Actions run `32629172660` executes the maintained chain on the C4 runtime/test HEAD.

Before the unrelated Practice failure, the run confirms:

- `tests/resource_paths.py`: pass;
- `tests/dead_code.py`: pass;
- `tests/assets_health.py`: pass;
- `tests/validate.py`: pass;
- `tests/looper66_contract.py`: pass;
- `tests/js_health.py`: pass — 173 functions, 96 top-level bindings, no dead declarations;
- `tests/core_unit.js`: pass;
- `tests/auto_mix_unit.js`: pass;
- every SP1200 DSP/input/output/level unit gate: pass;
- `tests/sp1200_browser.py`: pass;
- `tests/sp1200_races.py`: pass;
- `tests/punch_preview_race.py`: pass — `input` invalidates a pending combined PLAY before release.

The maintained chain then reaches the same pre-existing full-project blocker in `tests/regression_v63.py`, where Playwright times out waiting for `#practiceOverlayOpen`. C4 does not touch Practice and does not claim a repository-wide green exit.

### Scores after C4

The same immutable baseline rubric is retained.

| Area | Baseline | After C3 | After C4 | Verdict |
| --- | ---: | ---: | ---: | --- |
| SP DSP | 8.3 | 8.3 | **8.3** | unchanged; DSP untouched |
| `renderSpChop()` / PAD-PLAY boundary | 7.8 | 7.8 | **7.8** | unchanged; boundary preserved |
| Claimable SP fidelity | 6.5 | 6.5 | **6.5** | unchanged; no new hardware claim/model |
| Async / race handling | 4.5 | 8.0 | **8.2** | D4 input-time resurrection window is closed under a maintained Chromium race |
| Ownership / architecture | 5.0 | 7.2 | **7.2** | renderer remains the invalidation owner; no new cross-domain writer or abstraction |
| DSP tests | 7.5 | 7.5 | **7.5** | unchanged |
| Integration tests | 4.0 | 6.8 | **7.0** | dedicated PUNCH input-only pending-PLAY regression now runs in the maintained CI path |
| Overall maintainability | 5.5 | 6.6 | **6.7** | PUNCH timing now matches the established input/change lifecycle without duplicate invalidation or dead code |
| **Total feature** | **5.8** | **7.0** | **7.1** | D4 closed with no regression in previously accepted SP contracts |

### Remaining debt after C4

Duplicate Drum invalidation paths and classic-script/global ownership remain non-blocking maintainability debt. They are not expanded into a cleanup queue and are not justification for a new abstraction.

The full-project draft PR remains red only because the maintained suite later hits the unrelated frozen Practice regression.

### C4 verdict

C4 is accepted. D4 is closed. B1-B6 and D4 are now closed at the SP1200 correction level. No score decreased, no runtime dead code was introduced, no DSP/fidelity claim changed, and the renderer-owned generation remains the only mechanism used to invalidate pending combined previews.

The SP1200 feature score is **7.1 / 10**, up from **7.0 / 10** at C3, **6.6 / 10** at C2 and **5.8 / 10** at baseline.