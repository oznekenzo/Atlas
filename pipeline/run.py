#!/usr/bin/env python3
"""
One command per dataset:  python3 pipeline/run.py <set-name> [--only register|diff|bake]

Layout:
  data/sets/<name>/dataset.json      commits (source files, messages, timestamps) + calibration + tuning
  data/sets/<name>/raw/c<i>.ply      symlinks to the source captures (created here from dataset.json)
  data/sets/<name>/out/              transforms.json, objects.json, label grids, aligned plys
  viewer/public/sets/<name>/         what the viewer loads

dataset.json:
{ "calibration_m": 6.1,                       # tape-measured longest wall-to-wall span
  "commits": [ {"file": "/abs/or/relative.ply", "message": "…", "captured": "ISO-8601"}, … ],
  "diff": { "wall_margin_m": 0.6, "voxel_frac": 0.008, "min_voxels": 60, "jitter_voxels": 2,
            "coverage_voxels": 12, "coverage_frac": 0.25, "opacity_solid": 0.2, "min_count": 2,
            "label_dilate_voxels": 2, "floor_band_voxels": 2, "floor_frac": 0.8 },
  "bake": { "prune_opacity": 0.05, "sh": 0 } }
"""
import json, os, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
name = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else None
if not name: sys.exit(__doc__)
only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
DATA = os.path.join(ROOT, "data", "sets", name); RAW = os.path.join(DATA, "raw"); PUB = os.path.join(ROOT, "viewer", "public", "sets", name)
ds = json.load(open(os.path.join(DATA, "dataset.json"))); os.makedirs(RAW, exist_ok=True); os.makedirs(PUB, exist_ok=True)
for i, c in enumerate(ds["commits"]):
    src = c["file"] if os.path.isabs(c["file"]) else os.path.join(DATA, c["file"]); dst = os.path.join(RAW, f"c{i}.ply")
    if not os.path.exists(src): sys.exit(f"missing capture: {src}")
    if os.path.islink(dst) or os.path.exists(dst): os.remove(dst)
    os.symlink(os.path.abspath(src), dst)
env = {**os.environ, "PATINA_DATA": DATA, "PATINA_PUB": PUB}
steps = ["register", "diff", "bake"] if not only else [only]
for step in steps:
    print(f"\n=== {step} ({name}) ===", flush=True)
    r = subprocess.run([sys.executable, os.path.join(ROOT, "pipeline", f"{step}.py")], env=env)
    if r.returncode: sys.exit(f"{step} failed")
print(f"\ndone → {PUB}   (open the viewer with ?set={name})")
