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
