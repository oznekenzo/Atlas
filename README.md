# Statefield

ATLAS (working names: State Atlas, Trace Systems, Alchemist, Worldstate, Patina) — spatial version control for gaussian-splat captures.

Four captures of one room → registered → voxel-diffed → objects tracked across states → browser viewer with version-control
semantics: states, diffs, a standard and the drift from it, and a written entry for every state, diff and object.

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
                single.py          one capture, no registration or diff: levelled, squared to its walls, floor at y = 0,
                                   the SPZ written, objects boxed by hand in dataset.json labelled; publishes like bake
                requirements.txt   pinned numpy / scipy / open3d
    viewer/     Vite + React + zustand + three.js + @sparkjsdev/spark
                src/store.ts           app state + the action log / reflog — the only thing React and the engine share
                src/manifest.ts        commits.json validation: a bad bake fails with the field name, not a stack trace
                src/engine/stage.ts    three.js + Spark: boot, layers, mode → per-object style, picking, camera, idle render gate
                src/engine/layer.ts    one commit on the GPU; declarative Style → RGBA repaint only when the style changes;
                                       also the objects-only copy (labelled splats compacted) a diff lends, and single objects
                                       (a ghost at the standard's place, a thing carried across a draft's floor)
                src/engine/gestures.ts camera gesture recording (orbit / pan / dolly, clicks excluded, dolly coalesced)
                src/engine/overlay.ts  detection overlay: framed boxes hugging each object's splats, tags placed by priority
                                       and dropped where they would collide, arrows with distances for what moved or drifted
                src/engine/minimap.ts  the map: the room from above, footprints, the standard's ghosts and links, the camera
                src/scene.ts           the scene model: things (one physical object across states, by its chain of ids), diffs,
                                       drift, standing, months — one definition of a move; the engine, the panels, the card and
                                       the month block read it and never re-derive it. src/scene.test.ts covers it (vitest)
                src/demo.ts            the deck's slides, the checklist, the tour, the ?s= start presets
                src/titleField.ts      the title's point field (the design's own code, typed)
                src/layout.ts          the grid's numbers, and the cells the walkthrough can spotlight
                src/components/        Title (the deck), Chrome (the bands, the site picker, the ATLAS menu, the checklist, the
                                       command bar, the mode readout, the guide, the confirm, the curtain), LeftColumn (the
                                       actions log, the map cell), ObjectCard and Panel (the right column's two cells),
                                       BottomBand (the timeline cells and the state's details), Pages (Notes), Stage
                ply2spz.mjs            ply → SPZ v3 using Spark's SpzWriter (NOT splat-transform: it writes SPZ v4, Spark 2.1 can't read it)
                smoke.py               headless end-to-end check of the built viewer (npm run build && npx vite preview, then python3 smoke.py)
    AUDIT.md    architecture + performance audit: findings, what was fixed, known limitations

## Screen
    The deck first: the name over a point field, five slides (the technology, the project, the problem, the
    fundamentals, the demo), and the floor; the captures load behind it from landing, and the last slide's ENTER
    is live once June's is in: the floor opens on the second month, Jun 2026, with its first stations in. Then the
    room, full bleed, under a grid of translucent bands with hairlines:
      top band       the command bar (every command available now, with its key), the mode readout hanging under it
      left column    the site picker in its cell (another floor opens its set in place of this one, under the
                     curtain), the demo checklist (six things to do, ticked by real state), the
                     actions log (each entry restorable), and the map in the bottom cell (click a thing to open it,
                     bare floor to stand there)
      right column   the ATLAS menu (Notes, Restart demo), then two cells that grow to their content:
                     the selected object (its months, its entry) and the layout — the diff, the comparison to the
                     standard, or the draft
      bottom band    four timeline cells (month, year, STANDARD / OFF STANDARD / n of 4; the current one tinted, with
                     a MAKE THIS THE STANDARD tab that asks before it acts) over the state's details: date, sequence,
                     status, stoppages, changeover, output; what is in it; its entry
    Keys: ← → states · D diff · C compare to standard · N draft · M measure · F notes · esc back.
    Every command is also a click. A first arrival runs a seven-stop tour of the controls (Enter steps, Skip ends it),
    and the camera drifts slowly around the room until the first press or scroll on the scene; once per page load.
    A reload after the deck opens on the room, on the floor it left, with the checklist and the tour as they were
    (session storage, per tab) and the drift again; Restart demo forgets that, so the next reload shows the deck.
    Diff (D): the state before this one against it, or the standard against a later one; added tinted green, removed
    red from the earlier capture's own splats, a moved thing's old place faded under an arrow with the distance.
    Compare to standard (C): the standard's ghosts drawn in this state from its own capture, violet, each drifted
    thing tied to where it belongs; the panel says what the state must do to match. Draft (N): a layout tried on the
    empty floor, from scratch or from a state whose things start as placements; pick from the tray, click the floor,
    click a placed thing to pick it up again; Measure counts what is down. Nothing is written back.
    The grid is 268 px left, 328 px right, 48 px top, 164 px bottom; the picture is offset so the room centres in
    the middle cell. Designed for 1280 px and up. The HUD follows attention: full while the pointer is on it,
    lighter while the pointer is in the room or a drag is under way, and gone after two still seconds in the
    room; a click on a thing brings it back, a menu or the walkthrough pins it in full.
    ?s=<preset> opens the room in a state for testing: empty, explore, selected, compare, drift, ghosts,
    restore-hand, measured, footnotes, history. ?nointro skips the deck; ?debug exposes window.__patina;
    ?set=<name> opens another set than the garage.

## Run
    pip install -r pipeline/requirements.txt
    python3 pipeline/make_synthetic.py && python3 pipeline/run.py synthetic      # or: python3 pipeline/test_synthetic.py
                                                                                # (pipeline test only; its published set is ignored)
    python3 pipeline/run.py garage
    python3 pipeline/single.py bellevue                # the one-capture set: no registration, no diff
    cd viewer && npm install && npm run dev            # npm run check = typecheck + prettier + vitest; npm run build typechecks first
    ?debug on the URL exposes window.__patina (the hooks smoke.py drives); the dev server exposes it always

## Datasets
    viewer/public/sets/<name>/{commits.json, commits/*.spz, commits/*.labels.bin}
    the viewer opens the garage set first (DEFAULT_SET in src/store.ts); the site picker opens whichever set a site
    names, so every set carries the same "sites" list; the synthetic set exists only for the pipeline's own test
    garage    four states of a one-car garage (Torrance · Bay 1 on the picker); plants stand in for carts and tools
    bellevue  one state of a Harley-Davidson service bay (Bellevue · Bay 2): "Harley-Davidson Service Shop, Bellevue WA"
              by Paolo Tosolini, superspl.at/scene/ec4683ec, CC BY 4.0, captured with an XGRIDS PortalCam. Brought in
              with pipeline/single.py; its ten objects are boxes drawn by hand in data/sets/bellevue/dataset.json
    dataset.json carries the documentation, passed through publish untouched: per commit "doc", "by" and "stats"
    {stoppages, changeover, output} (doc null = no entry, shown as such); "diffs": {"a-b": {"doc", "by"}}; per object
    "doc" and "by"; "sites": the site picker, [{id, name, count, set}] with set = the directory under sets/ the floor
    opens (a site without one is a label only); "standard": the commit that is the approved layout

## Bringing in a new set of captures
    0. python3 pipeline/slim_ply.py <export.ply> data/sets/<name>/source/cN.ply   (sources stay untracked)
    1. mkdir data/sets/<name>; write data/sets/<name>/dataset.json (schema in pipeline/run.py, defaults in pipeline/dataset.py):
       the capture files (any path), a message + timestamp per commit, calibration_m (tape-measure the longest wall),
       and optional tuning blocks — "diff": wall_margin_m ignores anything near the walls; "registration": up
       ("auto" = the denser end of the vertical range is the floor, "keep"/"flip" override it), min_inlier_frac and
       min_candidate_margin (the run fails loudly when the registration is weak or the room's symmetry is ambiguous).
    2. python3 pipeline/run.py <name>        (needs: pip install -r pipeline/requirements.txt; node + viewer/node_modules)
    3. add it to "sites" in every set's dataset.json (id, name, count, set) and --only publish them, or open it with
       ?set=<name>; name objects with "objects": {"<id>": "name"} and drop artefacts (a stray
       blob at the ceiling) with "exclude": [<id>, ...], and cut an object the tracker kept alive under whatever
       replaced it with "removed": {"<id>": <commit>} in dataset.json, then --only publish (seconds: it needs the
       .spz files, not the captures). Ids there are the diff's ids (out/objects.json, or source_id in commits.json);
       the published ids are renumbered to stay compact, and publish logs the mapping.
    Tuning lives in dataset.json, never in code; the splat files carry nothing but splats.
    Only the register step needs open3d; diff, bake and publish run on numpy + scipy.

## Bringing in a single capture
    A set with one state has nothing to register against and nothing to diff, so pipeline/single.py does the frame
    on its own and takes the objects from the dataset: python3 pipeline/single.py <name>. dataset.json carries, beyond
    the usual keys, "frame" (up axis, yaw, centre: "auto" first, then pin what the run logs), "room", "view" (where
    the camera opens), "voxel", and "objects": {"<id>": {name, doc, by, box: [[x, y, z], [x, y, z]]}} in world metres;
    the splats inside a box are the object's. out/top.png is the floor from above on a 1 m grid with the boxes drawn.
    Needs numpy only, plus node + viewer/node_modules for the SPZ. The capture is expected to be metric.

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
- A diff draws the later capture whole and lends the earlier one's objects only: the room is untouched between
  captures, so two copies of the walls would blur against each other at the ~1 cm registration residual.
- The detection overlay is always on, re-projected every frame. Every value on it is measured (a name, a distance);
  nothing invents a confidence score, because there is no detector here to be confident. Tags are dropped where they
  would collide, so the frames stay dense and the type stays readable. The frames are also the hit boxes.
- The deck is opaque, so the engine skips rendering while it is up; the captures still load and label behind it.
- Spark regenerates a mesh only when its version moves: after rewriting rgba.array call mesh.updateVersion(), and again
  after changing mesh.opacity (it is baked at generation time). Visibility changes land only after Spark's async sort
  completes — give it frames (SparkRenderer's onDirty callback says when) and never stop the loop while spark.sorting.
- Software-GL Chromium (the sandbox smoke test) never completes Spark's sort, so a diff or a change of state looks stale there.
  Everything that changes the visible set has to be eyeballed on a real GPU; smoke.py asserts state, not pixels.
- A hand-boxed object (single.py) owns every splat inside its box, floaters included. Keep the box's floor edge 5 cm up
  so the floor stays static, and where boxes overlap give the thing on top the higher id: later ids win.
- Switching sets while a load is in flight: the engine numbers each open(); a load from an earlier one is dropped when it
  lands (its mesh disposed), so a fast double switch never leaves a stray layer in the room.
- Editing engine/stage.ts with the dev server open remounts the Stage under Vite HMR, which disposes the engine mid-load and
  logs "Worker terminate" from Spark once. A fresh load has no such error.
