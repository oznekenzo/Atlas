# Statefield

Patina — spatial version control for gaussian-splat captures.

Six captures of one room → registered → voxel-diffed → objects tracked across commits → browser viewer with git semantics.

## Layout
    pipeline/   make_synthetic.py  (test data: 6 commits as real 3DGS .ply, arbitrary frame+scale each)
                register.py        room-frame registration (floor/walls → 8 symmetry candidates → ICP → similarity refine)
                diff.py            voxel occupancy diff, component tracking, per-commit label grids
                bake.py            world frame (metric, y-up), SPZ via Spark's own writer, commits.json
                splat_io.py        3DGS ply read/write/transform
    viewer/     Vite + React + zustand + three.js + @sparkjsdev/spark
                src/store.ts          app state (head, mode, selection, load progress) — the only thing React and the engine share
                src/engine/stage.ts   three.js + Spark: meshes, per-splat RGBA, diff recolor, picking. Subscribes to the store; no React
                src/components/       Stage (mounts the engine), Hud, Rail, Legend, Card, Terminal, Footer
                src/git.ts            the git command parser; src/actions.ts adapts it to the store
                ply2spz.mjs        ply → SPZ v3 using Spark's SpzWriter (NOT splat-transform: it writes SPZ v4, Spark 2.1 can't read it)
    test_viewer.py  headless Chromium driver

## Run
    cd pipeline && python3 make_synthetic.py && python3 register.py && python3 diff.py && python3 bake.py
    cd ../viewer && npm install && npm run dev

## With real Teleport captures
    drop c0..c5.ply into data/raw/, set CAL_M in bake.py to one tape-measured wall span, run register → diff → bake.
    Name objects by editing "name" in viewer/public/commits.json.

## Gotchas found the hard way
- Generic FPFH+RANSAC registration fails on box-shaped rooms (flips 180°, reports 0.99 fitness). Use register.py's room-frame method.
- Splat surfaces are 1-voxel shells: never binary-open them; dilate → label → filter by size.
- Voxel size must track splat spacing (adaptive in diff.py); a fixed 3 cm voxel is wrong for sparse or dense data.
- SpzWriter.setScale wants LINEAR scale (it logs internally). Passing log scales gives invisible 45 µm splats.
- Static hosts add Content-Encoding for .gz files; the label loader sniffs the gzip magic and copes either way.
- mesh.splatRgba must be followed by mesh.updateGenerator(); after that, mutate rgba.array + rgba.needsUpdate (no rebuild).
- Per-splat RGBA injection is disabled when Spark LOD is on. Don't pass lod: true.
- Hidden splats need rgb=0 AND alpha=0 (premultiplied blending; alpha 0 with rgb>0 adds light).
