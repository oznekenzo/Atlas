"""Apply registration to each raw .ply, write aligned .ply, compress to .spz (Spark loads it natively),
   and write viewer/public/commits.json. Order of splats is irrelevant downstream (label grids are spatial)."""
import numpy as np, json, os, subprocess, hashlib, shutil
from splat_io import read_ply, write_ply, transform_raw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATA = os.environ.get("PATINA_DATA", os.path.join(ROOT, "data")); RAW = os.path.join(DATA, "raw"); OUT = os.path.join(DATA, "out")
PUB = os.environ.get("PATINA_PUB", os.path.join(ROOT, "viewer", "public")); os.makedirs(f"{PUB}/commits", exist_ok=True)
PRUNE_OPACITY = float(os.environ.get("PATINA_PRUNE", "0.05"))     # drop near-invisible splats (about a third of a real capture, ~5% of its mass)
TJ = json.load(open(f"{OUT}/transforms.json")); T = TJ["transforms"]
# commit metadata: truth.json (synthetic) or commits.meta.json (real captures)
if os.path.exists(f"{RAW}/truth.json"):
    truth = json.load(open(f"{RAW}/truth.json")); META = truth["commits"]; CAL_M = 6.5
else:
    meta = json.load(open(f"{RAW}/commits.meta.json")); META = meta["commits"]; CAL_M = float(meta["calibration_m"])
N_COMMITS = len(META)
# world frame for the viewer: c0 raw -> unit room frame (floor z=0) -> metres -> y-up (three.js)
Tcanon = np.array(TJ["ref_canon"]); Tm = np.diag([CAL_M, CAL_M, CAL_M, 1.0])
Tyup = np.array([[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]], float)          # z-up -> y-up
WORLD_FROM_REF = Tyup @ Tm @ Tcanon

commits = []
for ci in range(N_COMMITS):
    d = read_ply(f"{RAW}/c{ci}.ply")
    keep = d["opacity"] >= PRUNE_OPACITY
    raw = transform_raw(d["raw"][keep].copy(), d["names"], WORLD_FROM_REF @ np.array(T[f"c{ci}"]))
    aligned = f"{OUT}/c{ci}.aligned.ply"; write_ply(aligned, raw, d["names"])
    spz = f"{PUB}/commits/c{ci}.spz"
    # SPZ via Spark's own SpzWriter (splat-transform 3.x writes SPZ v4, which Spark 2.1 does not read)
    subprocess.run(["node", os.path.join(ROOT, "viewer", "ply2spz.mjs"), aligned, spz, "1"], check=True, capture_output=True)
    h = hashlib.sha1(open(spz, "rb").read()).hexdigest()[:7]
    tc = META[ci]
    commits.append({"id": f"c{ci}", "index": ci, "hash": h, "message": tc["message"], "captured": tc["captured"],
                    "file": f"commits/c{ci}.spz", "splats": len(raw), "labels": f"commits/c{ci}.labels.bin"})
    shutil.copy(f"{OUT}/c{ci}.labels.bin", f"{PUB}/commits/c{ci}.labels.bin")
    print(f"c{ci}  {len(d['raw']):>9,} -> {len(raw):>9,} splats (pruned <{PRUNE_OPACITY})   spz {os.path.getsize(spz)/1e6:5.1f} MB   {h}")

objs = json.load(open(f"{OUT}/objects.json"))
# names: hand-labelled in production; here from ground truth by location so the viewer test is honest
json.dump({"commits": commits, "voxel": objs["voxel"], "origin": objs["origin"], "shape": objs["shape"],
           "world_from_ref": WORLD_FROM_REF.tolist(), "calibration_m": CAL_M,
           "objects": [{**o, "name": f"Object {o['id']:02d}"} for o in objs["objects"]]},
          open(f"{PUB}/commits.json", "w"), indent=1)
print("wrote", f"{PUB}/commits.json")
