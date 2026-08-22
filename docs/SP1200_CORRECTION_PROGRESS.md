# SP1200 correction progress

Branch: `correct-SP1200`
Baseline runtime commit: `8f9afac574bb8f201548f9f97139df33f8fd45da`
Baseline audit: `docs/SP1200_CORRECTION_AUDIT_BASELINE.md`

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
