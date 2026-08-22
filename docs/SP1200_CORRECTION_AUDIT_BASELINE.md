# SP1200 correction audit baseline

Baseline branch: `SP1200`
Baseline commit: `8f9afac574bb8f201548f9f97139df33f8fd45da`
Correction branch: `correct-SP1200`
Audit date: 2026-08-22

## Purpose

This file is the acceptance baseline for the SP1200 correction branch.

Every runtime or test change on `correct-SP1200` must be evaluated against this audit **before it is accepted and pushed**. A change is rejected if it lowers any score below this baseline or creates a new unresolved regression/dependency without an explicit, evidence-based justification.

The goal is not to improve scores by changing the rubric. Scores are reassessed from the resulting code and maintained tests, with the same criteria after every step.

## Baseline verdict

Overall feature score: **5.8 / 10**
Merge verdict: **not mergeable**

| Area | Baseline score |
| --- | ---: |
| SP DSP (`js/sp1200.js`) | 8.3 / 10 |
| `renderSpChop()` / PAD-PLAY boundary | 7.8 / 10 |
| Claimable SP fidelity | 6.5 / 10 |
| Async / race handling | 4.5 / 10 |
| Ownership / architecture | 5.0 / 10 |
| DSP tests | 7.5 / 10 |
| Integration tests | 4.0 / 10 |
| Overall maintainability | 5.5 / 10 |
| **Total feature** | **5.8 / 10** |

## Strong parts that must not regress

### DSP scope and honesty

`js/sp1200.js` has a deliberately narrow DSP responsibility and labels derived models instead of claiming bit-perfect emulation. Current model identifiers include:

- `service-manual-42dboct-derived-v1`
- `carry7-pattern-v1`
- `ad7524-ideal-transfer-v1`
- `mux8-sh-zoh-v1`
- `fixed34-derived-v1`

This DSP layer should not be expanded as part of the lifecycle correction work.

### Shared SP chop render boundary

`renderSpChop()` is considered a valid abstraction because it owns a complete transition:

`range -> audible duration -> encoded PCM page/cache -> async encode -> DSP reconstruction`

PAD and PLAY/SAVE can use this boundary without duplicating the SP sample render algorithm.

## Blocking findings

### B1 — maintained race test is incompatible with current PLAY implementation

Current `events.js` uses:

```js
const generation=invalidatePreviewRender();
```

Current `tests/sp1200_races.py` still requires the previous implementation text:

```python
assert 'const generation=++previewRenderGeneration' in play_block
```

`tools/test_all.py` runs `tests/sp1200_races.py`, so the maintained suite is currently internally inconsistent before browser execution.

**Acceptance target:** update the test to protect behavior/ownership, not the old syntax. A correction is not accepted unless this maintained gate is coherent with the runtime.

### B2 — preview invalidation does not yet have one writer/owner

`drums.js` defines `invalidatePreviewRender()`, but the invalidation mechanism is still bypassed by other files.

Known bypasses include:

- `chopper-sp1200.js` directly increments `previewRenderGeneration` and writes `renderedFlip=null` for SP ON/OFF and RAW/FILTER changes;
- `chopper-banks.js` directly writes `renderedFlip=null` in bank state transitions;
- `chopper-wave-slices-core.js` directly writes `renderedFlip=null` for slice edits/mode changes;
- the VINYL control directly writes `renderedFlip=null`.

**Acceptance target:** mutations that make a pending combined preview obsolete must request invalidation through the renderer-owned operation. No new state manager, render context, dependency container or compatibility layer is allowed.

### B3 — BANK change can still publish an obsolete pending PLAY

`selectBank()` stops the active beat only when `isLoopPlaying` is already true. During async render, `isLoopPlaying` is still false. Clearing `renderedFlip` alone does not advance the generation token, so a render started in the old bank can still complete and be published after the UI moved to another bank.

**Acceptance target:** a bank mutation invalidates a pending preview before the bank state changes. Active transport behavior remains explicitly separate.

### B4 — SLICES mutations can still publish an obsolete pending PLAY

Slice boundary edits, insertion, edit-mode changes and drag completion still clear `renderedFlip` directly without consistently invalidating the pending render generation.

**Acceptance target:** the owning slice mutation operations invalidate the pending combined preview exactly through the renderer contract. Event handlers should delegate to the owning mutation function instead of duplicating invalidation.

### B5 — VINYL pending-render lifecycle is inconsistent

VINYL change currently clears the rendered buffer but does not consistently invalidate a pending combined preview at the first meaningful setting mutation.

**Acceptance target:** a VINYL setting change cannot allow an older pending render to become audible afterward. Avoid adding a separate VINYL generation/token.

### B6 — sample load lifecycle is incomplete

`loadChopperSample()` invalidates a pending preview and stops chop audition, but the full transport/load semantics are not completely defined. A currently audible combined preview can outlive the source-context switch, and rapid successive sample loads need an explicit last-request-wins behavior if their decodes overlap.

**Acceptance target:** loading a replacement sample cannot leave old combined audio/context presented as current. Do not solve this by introducing a broad global cancellation framework.

## Non-blocking findings / debt

### D1 — direct token manipulation remains inside renderer functions

`rerenderPreviewMode()`, `playDrumsPreview()` and `stopCurrentBeat()` still manipulate `previewRenderGeneration` internally. This may be valid because they are renderer-owned lifecycle operations. The correction should not mechanically route every internal increment through a public function if that obscures ownership.

The real rule is: **external domains do not directly mutate renderer state**.

### D2 — duplicate invalidation in Drum edit paths

Some Drum edit workflows can invalidate before calling `markDrumSelectionEdited()`, which invalidates again. The token is monotonic, so this is not currently a correctness bug, but it is a clarity/ownership smell.

Do not clean this up unless the change is small, verified and does not broaden the current correction.

### D3 — SAVE remains a separate contract

SAVE intentionally renders the current state and does not reuse the preview cache. It should not be forced onto the preview-generation token merely for symmetry.

If STOP-vs-SAVE cancellation is changed later, it requires a separate product/ownership decision and regression test.

### D4 — PUNCH input timing

PUNCH is a range control whose visual value can change during `input`, while preview invalidation currently occurs at `change`. This leaves a small temporal mismatch compared with BPM/reverb invalidation.

Treat this after the primary pending-render ownership gaps unless a test demonstrates a user-visible race.

## Required correction strategy

1. Work only on branch `correct-SP1200`.
2. Before each runtime change, identify the exact baseline finding it addresses.
3. Keep each commit limited to one ownership/race problem where practical.
4. Compare the resulting diff against the previous accepted commit and this baseline.
5. Re-run/review the relevant maintained tests before accepting the commit.
6. Reject/revert changes that introduce unrelated formatting churn, new abstractions or cross-domain writes.
7. Re-score the same table after every accepted correction step.
8. **No score may decrease below this baseline.** A lower score means the change is rejected/reworked rather than rationalized.
9. Do not change the scoring rubric to make a modification appear successful.
10. No additional SP DSP/fidelity layers until lifecycle/integration blockers are closed.

## Target lifecycle contract

```text
mutation that changes a combined preview input
              |
              v
      invalidatePreviewRender()
              |
              v
old pending preview may finish computation
but cannot publish/start playback

STOP
  |
  +--> invalidate pending preview
  +--> stop active combined preview
  +--> stop active chop audition
```

The implementation should preserve separate domain responsibilities and must not introduce a `RenderContext`, state-management object, new renderer file or compatibility layer solely for this correction.

## Acceptance criteria for leaving the correction branch

The branch is eligible for merge review only when all of the following are true:

- maintained source-contract tests are consistent with the runtime;
- pending PLAY cannot resurrect after BANK mutation;
- pending PLAY cannot resurrect after SLICES mutation;
- pending PLAY cannot resurrect after relevant SP RAW/FILTER/ON-OFF mutation;
- pending PLAY cannot resurrect after VINYL mutation;
- sample replacement cannot leave an obsolete combined preview presented as current;
- relevant races are covered by behavioral tests rather than implementation-string assertions where browser behavior can be tested;
- the SP DSP score has not decreased;
- `renderSpChop()` remains a complete, non-duplicated boundary;
- no new runtime abstraction/file has been added without an independently justified responsibility;
- final rescoring has no category below the baseline values above.

## Baseline note on CI

At baseline commit `8f9afac574bb8f201548f9f97139df33f8fd45da`, GitHub reports no published status checks. Therefore absence of a failing GitHub status is **not** evidence that the project suite passed.
