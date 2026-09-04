# Statefield

ALCHEMIST (working names: State Atlas, Worldstate, Patina) — spatial version control for gaussian-splat captures.

Six captures of one room → registered → voxel-diffed → objects tracked across commits → browser viewer with git semantics.

## Layout
    pipeline/   run.py             the CLI: python3 pipeline/run.py <set> [--only register|diff|bake|publish]
                dataset.py         Dataset (paths, dataset.json validation) + RegisterParams / DiffParams / BakeParams defaults
                register.py        room-frame registration (floor/walls → 8 symmetry candidates → ICP → similarity refine);
                                   decides up/down once and folds it into ref_canon (z up, floor at z = 0, unit span)
                diff.py            voxel occupancy diff, object tracking (partial removals, moves, originals), label grids
                bake.py            world frame (metric, y-up), SPZ via Spark's own writer; publish = label grids + commits.json
                                   with the curation from dataset.json (object names, excluded artefacts, ids renumbered)
                splat_io.py        3DGS ply read (memmap) / write / similarity transform incl. SH band 1
                make_synthetic.py  test data: 6 commits as real 3DGS .ply, arbitrary frame+scale each → data/sets/synthetic/
                test_synthetic.py  end-to-end check against truth.json (registration < 15 mm, objects found, contract kept)
                slim_ply.py        drops SH bands + sub-0.05 splats from a full export (943 MB → ~120 MB); numpy only
                requirements.txt   pinned numpy / scipy / open3d
    viewer/     Vite + React + zustand + three.js + @sparkjsdev/spark
                src/store.ts           app state + the action log / reflog — the only thing React and the engine share
                src/manifest.ts        commits.json validation: a bad bake fails with the field name, not a stack trace
                src/engine/stage.ts    three.js + Spark: boot, layers, mode → per-object style, picking, camera, idle render gate
                src/engine/layer.ts    one commit on the GPU; declarative Style → RGBA repaint only when the style changes;
                                       also the objects-only copy (labelled splats compacted) that onion layers and traces
                src/engine/gestures.ts camera gesture recording (orbit / pan / dolly, clicks excluded, dolly coalesced)
                src/engine/overlay.ts  detection overlay: 2D boxes projected from the object bboxes, tags placed by
                                       priority and dropped where they would collide with each other or the chrome
                src/components/        Intro (the title card: the load writes the log, → begins), Stage (mounts the engine), Hud,
                                       Nav (wordmark · rail · hints), Legend, Card, ActionLog, Terminal
                src/identity.ts        one physical thing across commits: follows moved_from/moved_to so the card, the
                                       legend, blame and bisect give a thing one history, and a move reads as a move
                src/git.ts             the git command parser (pure); src/actions.ts adapts it to the store
                ply2spz.mjs            ply → SPZ v3 using Spark's SpzWriter (NOT splat-transform: it writes SPZ v4, Spark 2.1 can't read it)
                smoke.py               headless end-to-end check of the built viewer (npm run build && npx vite preview, then python3 smoke.py)
    AUDIT.md    architecture + performance audit: findings, what was fixed, known limitations

## Run
    pip install -r pipeline/requirements.txt
    python3 pipeline/make_synthetic.py && python3 pipeline/run.py synthetic      # or: python3 pipeline/test_synthetic.py
    python3 pipeline/run.py garage
    cd viewer && npm install && npm run dev            # npm run check = typecheck + prettier; npm run build typechecks first
    ?debug on the URL exposes window.__patina (the hooks smoke.py drives); the dev server exposes it always

## Datasets
    viewer/public/sets/<name>/{commits.json, commits/*.spz, commits/*.labels.bin}
    open the viewer with ?set=<name>  (default: garage — the real captures; synthetic — the generated test set)
    the set opens on c0 behind a title card and loads forward in time; → (or Enter) begins, and the chrome fades in

## Bringing in a new set of captures
    0. python3 pipeline/slim_ply.py <export.ply> data/sets/<name>/source/cN.ply   (sources stay untracked)
    1. mkdir data/sets/<name>; write data/sets/<name>/dataset.json (schema in pipeline/run.py, defaults in pipeline/dataset.py):
       the capture files (any path), a message + timestamp per commit, calibration_m (tape-measure the longest wall),
       and optional tuning blocks — "diff": wall_margin_m ignores anything near the walls; "registration": up
       ("auto" = the denser end of the vertical range is the floor, "keep"/"flip" override it), min_inlier_frac and
       min_candidate_margin (the run fails loudly when the registration is weak or the room's symmetry is ambiguous).
    2. python3 pipeline/run.py <name>        (needs: pip install -r pipeline/requirements.txt; node + viewer/node_modules)
    3. open the viewer with ?set=<name>; name objects with "objects": {"<id>": "name"} and drop artefacts (a stray
       blob at the ceiling) with "exclude": [<id>, ...], and cut an object the tracker kept alive under whatever
       replaced it with "removed": {"<id>": <commit>} in dataset.json, then --only publish (seconds: it needs the
       .spz files, not the captures). Ids there are the diff's ids (out/objects.json, or source_id in commits.json);
       the published ids are renumbered to stay compact, and publish logs the mapping.
    Tuning lives in dataset.json, never in code; the splat files carry nothing but splats.
    Only the register step needs open3d; diff, bake and publish run on numpy + scipy.

## Gotchas found the hard way
- Generic FPFH+RANSAC registration fails on box-shaped rooms (flips 180°, reports 0.99 fitness). Use register.py's room-frame method.
- Splat surfaces are 1-voxel shells: never binary-open them; dilate → label → filter by size.
- Judge change against the other capture's above-floor geometry only. Measured against everything, the jitter
  allowance (2 voxels) plus the floor under a new object eats its bottom 20 cm, and a 20 cm sculpture vanishes.
- A garage ceiling sheds candidates: door tracks, the opener, splats poking through the ceiling. The diff rejects
  anything whose median height sits within ceiling_band_voxels of the ceiling or whose top pokes through it.
- Voxel size must track the room (voxel_frac of the span in diff.py); a fixed 3 cm voxel is wrong for sparse or dense data.
- Object boxes must be axis-aligned in the canonical (room) frame, not the registration frame: the reference capture
  is yawed against the room, so a box aligned to it is up to √2 too wide, and re-fitting it after the rotation to
  world inflates it again (a 0.8 m chair reported 1.5 m).
- A near-square empty room is ambiguous under 90/180-degree yaw once scale is free; register.py refuses when the best
  symmetry candidate does not clearly beat the runner-up. Real rooms have fixtures; the synthetic one had to be given some.
- SpzWriter.setScale wants LINEAR scale (it logs internally). Passing log scales gives invisible 45 µm splats.
- Static hosts add Content-Encoding for .gz files; the label loader sniffs the gzip magic and copes either way.
- mesh.splatRgba must be followed by mesh.updateGenerator(); after that, mutate rgba.array + rgba.needsUpdate (no rebuild).
- Per-splat RGBA injection is disabled when Spark LOD is on. Don't pass lod: true.
- Hidden splats need rgb=0 AND alpha=0 (premultiplied blending; alpha 0 with rgb>0 adds light).
- Onion draws the commit you are standing in whole, and every other commit as objects only: the room is untouched
  between captures, so N copies of the walls cost N× and blur against each other at the ~1 cm registration residual.
  Selecting an object first turns onion into a trace of that one object — only its own past states appear, following
  the tracker's moved_from / moved_to links so a thing that was moved keeps its identity across commits.
- The detection overlay is always on, re-projected every frame. Every value on a tag is measured (id, name, occupied
  volume, the commits a state belongs to); nothing invents a confidence score, because there is no detector here to
  be confident. Tags are dropped where they would collide, so the brackets stay dense and the type stays readable.
- Spark regenerates a mesh only when its version moves: after rewriting rgba.array call mesh.updateVersion(), and again
  after changing mesh.opacity (it is baked at generation time). Visibility changes land only after Spark's async sort
  completes — give it frames (SparkRenderer's onDirty callback says when) and never stop the loop while spark.sorting.
- Software-GL Chromium (the sandbox smoke test) never completes Spark's sort, so diff/onion/checkout look stale there.
  Everything that changes the visible set has to be eyeballed on a real GPU; smoke.py asserts state, not pixels.
