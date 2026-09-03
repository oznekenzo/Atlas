# Architecture and performance audit

Scope: the whole repository as of the garage captures landing — `pipeline/` (register → diff → bake) and `viewer/`
(React + zustand + three.js + Spark). Method: two independent read-throughs (one per half), every finding checked
against the running code, then fixed in order of severity. The synthetic ground-truth test (`pipeline/test_synthetic.py`,
92 checks) and the headless viewer smoke test (`viewer/smoke.py`, 31 checks) both pass after the changes.

Status key — **fixed** in this pass · **mitigated** (reduced, not eliminated) · **open** (documented, deliberate).

## Pipeline

| # | Severity | Finding | Status |
|---|---|---|---|
| P1 | high | Registration used a fixed 3 cm voxel and absolute ICP thresholds; broke on sparse or large captures. | fixed — everything is relative to the room span (`voxel_frac`, threshold ladder ×4/×2/×1) |
| P2 | high | RANSAC plane fitting was unseeded: the same input could register differently run to run. | fixed — seeded; the run is reproducible |
| P3 | high | Registration accepted whatever ICP returned. A 180° flip on a near-square room scored 0.99. | fixed — 8 box-symmetry candidates, acceptance gate on inlier fraction *and* margin to the runner-up; refuses loudly |
| P4 | high | Diff treated "not observed" as "changed": a missing ceiling produced 58 removed objects. | fixed — per-object coverage mask (25 %), unobserved ≠ changed |
| P5 | high | Density-dependent occupancy: a floor re-captured at higher density showed up as an 864 k-voxel "added" object. | fixed — occupancy is ≥ `min_count` solid splats, independent of density; floor-plane and under-floor rules |
| P6 | med | Objects touching the walls were reported; the user only wants the interior. | fixed — `wall_margin_m` in dataset.json (centroid vs. room walls in the canonical frame) |
| P7 | med | Tuning constants lived in code; the next five scenes would need edits. | fixed — `dataset.json` carries `diff`, `registration`, `bake`, `objects` blocks; `Dataset` validates them |
| P8 | med | Ad-hoc scripts (`slim.py`, env vars, hard-coded paths); a stale `pipeline/ply2spz.mjs` duplicate. | fixed — `run.py <set> [--only …]`, in-process stages, one writer |
| P9 | med | Wrong SH coefficients were kept when slimming PLYs (channel-major layout misread) → black splats. | fixed — SH0 bake; the SPZ writer refuses absent bands; band-1 rotation implemented and tested |
| P10 | low | The viewer framed the camera from the voxel grid, which is padded ~2× beyond the walls. | fixed — the manifest now carries `room` (walls, floor, ceiling) from the canonical frame |
| P11 | low | Object tracking matches moved objects by size ±30 %; two similar boxes can pair wrongly. | open — acceptable for a demo; a shape descriptor is the next step |
| P12 | low | A box replaced in place by a similar box stays ~35 % "alive" (shared voxels). | open — inherent to occupancy diff without appearance |
| P13 | low | Registration assumes a rectangular room with a dominant floor plane. | open — documented; L-shaped rooms need a second wall pair |

Numbers (garage, two real captures, 1.6 M and 3.9 M splats): registration 72 % inliers at 0.2 % of span RMS;
8 interior objects incl. the lamp at wall margin 0.6 m; diff step 52 s, bake 40 s on a laptop-class CPU.

## Viewer

| # | Severity | Finding | Status |
|---|---|---|---|
| V1 | high | Hover repainted every splat of every visible layer through a closure (O(N) with a call per splat, ~4 M in the garage). | fixed — per-object `Style` tables; a tight closure-free loop; layers whose style is unchanged are skipped. Hover in diff mode and hover over the selected object cost 0 ms (asserted by the smoke test) |
| V2 | high | No error state: a missing set, a 404 on a commit or a malformed manifest hung on a black screen. | fixed — `status`/`error` in the store, `parseManifest` names the bad field, SPA index.html fallbacks are detected, per-commit load failures show on the rail |
| V3 | high | The render loop ran flat out while idle (100 % of a GPU for a still image). | fixed — idle gate: renders on change, for 1.2 s after, while Spark sorts, and at least once per change; Spark's `onDirty` reopens it |
| V4 | med | Labelling a 4 M-splat commit blocked the main thread for the whole pass. | fixed — chunked (256 k splats per task) with yields, using Spark's `unpackSplat` |
| V5 | med | Onion mode ignored commits that finished loading after it was entered. | fixed — `applyMode` also runs on `loaded` changes |
| V6 | med | `diffStats` were written into the store by the engine; two sources of truth for one number. | fixed — the legend derives them from the manifest |
| V7 | med | Boot was not abortable and `dispose` leaked the RgbaArrays, controls, timers and listeners (StrictMode double-mount). | fixed — AbortController, full teardown |
| V8 | med | Every component subscribed to the whole store; hover and camera motion re-rendered all of them. | fixed — selectors with `useShallow` everywhere; `setMoving`/`setHover` no-op on equal values |
| V9 | med | A camera tween fought user input; hover picking ran during drags. | fixed — controls disabled during a tween, pointerdown cancels it; no picking while dragging |
| V10 | med | `checkout`/`diff` failed silently on unloaded commits; the terminal printed success anyway. | fixed — they return booleans; the terminal reports "still loading" |
| V11 | med | Keyboard shortcuts fired on ⌘/Ctrl chords and key repeat, and inside inputs. | fixed |
| V12 | low | The git parser accepted only `c0`–`c9`, clamped `HEAD~n` silently, and matched ambiguous hash prefixes. | fixed — `c\d+`, out-of-range errors in git's wording, ambiguity reported |
| V13 | low | Terminal ran git commands inside a React state updater (side effects run twice under StrictMode). | fixed |
| V14 | low | `window.__patina` test hooks shipped to production untyped. | fixed — typed `DebugApi`, exposed only in dev or with `?debug` |
| V15 | low | `actions` (visible log) and `history` (reflog) were two arrays kept in sync by hand. | fixed — the log is derived from `history` |
| V16 | low | Manifest paths were rewritten in place; a 400-line `stage.ts`; no formatter or typecheck script. | fixed — `engine/layer.ts`, `engine/gestures.ts`, `manifest.ts`; prettier; `npm run check`; `build` typechecks first |
| V17 | low | Nav hints overlapped the commit rail below ~1400 px. | fixed — rail pitch and hints scale with the viewport |
| V18 | low | Hover still repaints the HEAD layer when emphasis changes (one full pass, ~15 ms for 480 k splats on software GL). | mitigated — a GPU-side style lookup (label texture + palette uniform) would make it free; not needed at this scale |
| V19 | low | Ghost layers are not pickable in onion mode. | open — deliberate: picking follows HEAD so a click never selects something you cannot see clearly |

Numbers (synthetic set, 6 commits × ~400 k splats, software GL in the sandbox): first commit on screen 1.6 s,
all six in 4.6 s after the manifest; diff repaint 17–24 ms; select 16 ms; hover in diff 0 ms; idle 0 fps.

## Contracts that now hold

- `dataset.json` is the only place tuning lives; splat files carry nothing but splats.
- `commits.json` is validated field by field before the engine sees it.
- Every user action is a `history` entry with a snapshot of the state after it; the reflog, the action log and
  `HEAD@{n}` are views of that one array. Amend-in-place is used only for continuing gestures (dolly).
- The engine never touches React; React never touches three.js. The store is the seam.

## Known limitations

- Registration assumes one dominant floor plane and roughly rectangular walls (P13).
- Object identity across commits is geometric (size + overlap); identical-looking replacements are not distinguished (P11, P12).
- Per-splat colour lives in a CPU array uploaded whole on change: 16 MB for a 4 M-splat commit, fine on a laptop GPU,
  not on a phone.
- The headless smoke test proves state transitions and repaint costs, not pixels: software-GL Chromium never
  finishes Spark's async sort, so anything that changes the visible set has to be checked on a real GPU.
