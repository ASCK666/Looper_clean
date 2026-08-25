# SP1200 correction C7 — fixed output pairs post-gate

Branch: `correct-SP1200`
Previous accepted state: C6 (`4066963c34e95634a31cf53e1171d97e6f7d9a66` documentation HEAD)
C7 runtime/test/validation HEAD: `ce2012b54658c1416a941696e7c8c362bbbda8f5`
Audit date: 2026-08-23

## Verdict

**C7 is accepted.**

The SP1200 output path now exposes the two documented fixed-output families separately while retaining RAW as the default:

`RAW -> fixed 3/4 -> fixed 5/6 -> RAW`

The change preserves the existing DSP/render/lifecycle ownership boundaries, introduces no new runtime JavaScript file or state abstraction, preserves RAW bit-for-bit at the native reconstruction rate, adds no unmeasured analog coloration, and passes every maintained SP1200 gate before the already-known unrelated Practice regression.

No C6 score decreases.

## Accepted C7 commits

Runtime:

- `89b2324fa8a63d30f4212fd2eb5cba3ff320189b` — `feat(sp1200): add fixed 5-6 output profile`;
- `dd9e6883085b56923d8354f4ec154edf34afef96` — `feat(sp1200): expose fixed output pairs`.

Post-gate tests/runner:

- `e20ed7e16ca3fdc83c225172b1fee0b8907cff51` — first pair-aware output-filter contract;
- `1fe51524dc2c4c0c5a6a94ee04a72435df19811b` — real-browser output-profile cycle, 5/6 PAD/PLAY parity and pending-render race;
- `df831128054961c54d61be6dc67a4ad1a2269332` — maintained runner executes the new profile regression before the frozen Practice gate;
- `ce2012b54658c1416a941696e7c8c362bbbda8f5` — separates the native filter-edge contract from composite 44.1/48 kHz ZOH reconstruction behavior.

## Runtime impact audit

Cumulative diff from C6 documentation HEAD `4066963c34e95634a31cf53e1171d97e6f7d9a66` to C7 runtime/test HEAD `ce2012b54658c1416a941696e7c8c362bbbda8f5`:

- `js/sp1200.js`: +27 / -13;
- `js/chopper-sp1200.js`: +15 / -9;
- `tests/sp1200_output_filter_unit.js`: +82 / -55;
- `tests/sp1200_output_profiles.py`: +192 / -0;
- `tools/test_all.py`: +1 / -0.

Exactly two runtime files change. The remaining changes are maintained tests/runner wiring.

### DSP ownership

`js/sp1200.js` remains the only owner of SP output filtering.

C7 adds:

- `filter56` as the higher fixed pair;
- model marker `fixed56-cheb5-derived-v1`;
- hardware pair metadata `5-6`;
- conservative derived cutoff `10000` Hz;
- the same documented fixed-filter family used by 3/4: five-pole, 1 dB-ripple Chebyshev type-I;
- `makeupGainDb: 0`;
- `exactCircuit: false`.

The existing 3/4 profile remains `fixed34-cheb5-derived-v2` at its conservative 9 kHz edge. RAW exits before either output filter.

No SP tuning/address carry code, 26.04 kHz/12-bit encoding, input preamp/filter, AD7524 level DAC, shared DAC multiplexing, sample/hold reconstruction, PCM cache or async encode path changes in C7.

### Product adapter / render boundary

`js/chopper-sp1200.js` keeps one existing compact output control. It now cycles the DSP-owned `outputModes` instead of creating another button or product state layer.

`renderSpChop()` is unchanged and still owns the complete SP chop transition shared by PAD and PLAY/SAVE.

PAD snapshots `requestOutputMode`; full PLAY/SAVE snapshots `renderOutputMode` before asynchronous work. `setOutputMode()` continues to invalidate pending combined preview work through the existing renderer-owned `invalidatePreviewRender()` operation. No new generation token or cross-domain renderer writer is introduced.

## Post-gate regression coverage

### DSP/output unit

`tests/sp1200_output_filter_unit.js` now protects:

- output mode set `raw,filter,filter56`;
- immutable metadata for both hardware pairs;
- RAW bit-for-bit behavior at the native SP reconstruction rate;
- shared 12-bit DAC / eight-slot sample-hold behavior;
- both fixed filters occurring after DAC/S&H reconstruction;
- native 3/4 edge near -1 dB at 9 kHz;
- native 5/6 edge near -1 dB at 10 kHz;
- strong native separation between the darker 3/4 pair and the more open 5/6 pair;
- low-band behavior and pair ordering at 44.1 and 48 kHz session reconstruction;
- rejection of a false `ssm2044-exact` output mode;
- Chopper snapshot/cycle/settings source contracts and DSP-only filter ownership.

### Important post-gate correction

The first multi-rate test revision incorrectly required the end-to-end `renderPcm()` RMS ratio to remain exactly -1 dB at the nominal analog edge at 44.1/48 kHz. GitHub Actions correctly rejected that assumption: at 44.1 kHz the 3/4 9 kHz composite render measured about -2.15 dB relative to RAW.

That was a test-model error, not accepted as a reason to alter the runtime. `renderPcm()` at a live session rate contains the intentional 26.04 kHz sample/hold reconstruction and its spectral images before the fixed output filter. C7 therefore keeps the strict -1 dB calibration contract on the native SP grid, while session-rate tests protect low-band transparency, pair ordering and 44.1/48 kHz stability. No runtime audio code was changed to satisfy the rejected test assumption.

### Browser/profile regression

`tests/sp1200_output_profiles.py` exercises the real application wiring and verifies:

1. actual button cycle `RAW -> 3/4 -> 5/6 -> RAW`, including UI text/ARIA state and reported hardware-pair metadata;
2. real 5/6 PAD audition and full PLAY use the same SP output profile through the shared `renderSpChop()` boundary and remain sample-aligned away from intentional product edge/finalize treatment;
3. changing 3/4 -> 5/6 while a combined PLAY is pending advances the existing renderer generation, rejects the stale PLAY result and starts no obsolete live source.

The regression is maintained by `tools/test_all.py` before the known Practice blocker. It is test-only and is not orphaned/dead code.

## Validation evidence

GitHub Actions run **#108**, run id `32633014241`, validates C7 runtime/test HEAD `ce2012b54658c1416a941696e7c8c362bbbda8f5`.

Before the unrelated Practice failure, the maintained chain reports:

- `tests/resource_paths.py`: PASS;
- `tests/dead_code.py`: PASS;
- `tests/assets_health.py`: PASS;
- `tests/validate.py`: PASS;
- `tests/looper66_contract.py`: PASS;
- `tests/js_health.py`: PASS — **173 functions, 96 top-level bindings, no dead declarations**;
- `tests/core_unit.js`: PASS;
- `tests/auto_mix_unit.js`: PASS;
- `tests/sp1200_dsp_unit.js`: PASS;
- `tests/sp1200_gain_unit.js`: PASS;
- `tests/sp1200_output_filter_unit.js`: PASS — native 3/4 `-1.0 dB @ 9 kHz`, native 5/6 `-1.0 dB @ 10 kHz`; at 48 kHz session reconstruction the 10 kHz composite ratios are approximately `-10.0 dB / -2.7 dB` for 3/4 versus 5/6;
- `tests/sp1200_level_dac_unit.js`: PASS;
- `tests/sp1200_browser.py`: PASS;
- `tests/sp1200_races.py`: PASS;
- `tests/sp1200_output_profiles.py`: PASS — RAW/3-4/5-6 cycle, 5/6 PAD/PLAY parity and pending-render invalidation;
- `tests/punch_preview_race.py`: PASS;
- `tests/drum_edit_invalidation.py`: PASS.

The maintained chain then fails in the same unrelated frozen-Practice regression:

- `tests/regression_v63.py`, line 147;
- waits for `#practiceOverlayOpen`;
- Playwright timeout after 15000 ms.

C7 does not touch Practice and does not claim a repository-wide green suite.

## Scores after C7

The same immutable baseline/C6 rubric is used. No score is raised merely because code was added.

| Area | C6 | C7 | Verdict |
| --- | ---: | ---: | --- |
| SP DSP | 8.5 | **8.6** | second documented fixed-output family is represented without broadening into unsupported analog models |
| `renderSpChop()` / PAD-PLAY boundary | 7.8 | **7.8** | unchanged; one shared SP chop boundary remains |
| Claimable SP fidelity | 6.9 | **7.2** | 5/6 is now distinct from 3/4/RAW, while its 10 kHz point remains explicitly derived |
| Async / race handling | 8.2 | **8.2** | unchanged; existing renderer generation correctly covers the new mode transition |
| Ownership / architecture | 7.2 | **7.2** | unchanged; DSP owns filtering and renderer owns combined-preview invalidation |
| DSP tests | 7.8 | **8.1** | both fixed pairs, native calibration, session reconstruction and RAW/S&H invariants are maintained |
| Integration tests | 7.1 | **7.4** | real UI cycle, 5/6 PAD/PLAY parity and 3/4->5/6 pending-PLAY race are covered in Chromium |
| Overall maintainability | 6.8 | **6.8** | compact existing control and shared DSP helper are reused; no runtime file/token/abstraction or dead declaration added |
| **Total feature** | **7.3** | **7.5** | meaningful SP fidelity/coverage gain with unchanged lifecycle and architecture boundaries |

## Remaining fidelity limits after C7

C7 does not claim bit-perfect hardware emulation.

Remaining caps include:

- the 9 kHz 3/4 edge remains a conservative derived calibration rather than a measured exact SP-1200 component transfer;
- the 10 kHz 5/6 edge is likewise explicitly derived, not an exact calibrated component transfer;
- dynamic SSM2044 behavior on channels 1/2 is still not modelled;
- sample/hold capacitor droop, channel crosstalk, analog DAC/MDAC nonlinearity, noise and saturation remain unmeasured/unmodelled rather than invented;
- the input anti-alias transfer and tuning/PROM phase remain honestly derived where public evidence is incomplete;
- classic-script/global ownership debt remains outside this focused SP fidelity correction.

## C7 acceptance

C7 passes its post-gate. No score falls below C6 or the immutable baseline, no dead code is introduced, RAW remains preserved, 3/4 remains preserved as the darker fixed family, 5/6 is independently exposed/tested, and the existing renderer lifecycle prevents stale output-profile renders from becoming audible.

SP1200 feature score: **7.5 / 10**.

The full-project PR remains draft because the maintained project chain still reaches the unrelated stale Practice selector after all maintained SP/C7 gates have passed.