"""
Apply the registration to each raw .ply, write the aligned .ply, compress it to .spz with Spark's own
SpzWriter (splat-transform 3.x writes SPZ v4, which Spark 2.1 does not read), copy the label grids and
write viewer/public/sets/<name>/commits.json. Splat order is irrelevant downstream (label grids are spatial).

World frame for the viewer: c0 raw -> canonical unit room frame (z up, floor at z = 0; from register.py)
-> metres (calibration_m) -> y-up (three.js).
"""
import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys

import numpy as np

from dataset import Dataset, PipelineError, ROOT
from splat_io import read_ply, sh_band_count, transform_raw, write_ply

log = logging.getLogger("bake")

PLY2SPZ = os.path.join(ROOT, "viewer", "ply2spz.mjs")
Z_UP_TO_Y_UP = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)


def world_from_ref(ref_canon, calibration_m):
    metres = np.diag([calibration_m, calibration_m, calibration_m, 1.0])
    return Z_UP_TO_Y_UP @ metres @ ref_canon


def ply_to_spz(aligned, spz, sh):
    result = subprocess.run(["node", PLY2SPZ, aligned, spz, str(sh)], capture_output=True, text=True)
    if result.returncode:
        raise PipelineError(f"ply2spz failed on {aligned} (exit {result.returncode}):\n{result.stderr.strip()}")
    for line in result.stderr.strip().splitlines():
        log.warning(f"  ply2spz: {line}")
    if result.stdout.strip():
        log.info(f"  {result.stdout.strip()}")


def bake_commit(ds, commit, T, params):
    d = read_ply(ds.raw_ply(commit.index))
    if params.sh >= 2:
        raise PipelineError(f"bake.sh = {params.sh}: only SH degrees 0 and 1 are supported "
                            f"(rotating bands >= 2 is not implemented)")
    if params.sh == 1 and sh_band_count(d["names"]) < 3:
        raise PipelineError(f"bake.sh = 1 but {ds.raw_ply(commit.index)} carries no SH band 1 coefficients")
    if params.prune_opacity > 0:
        keep = d["opacity"] >= params.prune_opacity
    else:
        keep = np.ones(len(d["opacity"]), bool)
    raw = transform_raw(np.asarray(d["raw"][keep]), d["names"], T)     # boolean indexing copies out of the memmap
    aligned = ds.aligned_ply(commit.index)
    write_ply(aligned, raw, d["names"])
    spz = os.path.join(ds.pub_dir, "commits", f"c{commit.index}.spz")
    ply_to_spz(aligned, spz, params.sh)
    with open(spz, "rb") as fh:
        digest = hashlib.sha1(fh.read()).hexdigest()[:7]
    shutil.copy(ds.labels_path(commit.index), os.path.join(ds.pub_dir, "commits", f"c{commit.index}.labels.bin"))
    log.info(f"c{commit.index}  {len(d['raw']):>9,} -> {len(raw):>9,} splats (pruned <{params.prune_opacity})   "
             f"spz {os.path.getsize(spz) / 1e6:5.1f} MB   {digest}")
    return {"id": f"c{commit.index}", "index": commit.index, "hash": digest, "message": commit.message,
            "captured": commit.captured, "file": f"commits/c{commit.index}.spz", "splats": int(len(raw)),
            "labels": f"commits/c{commit.index}.labels.bin"}


def run(ds):
    params = ds.bake
    TJ = ds.load_transforms()
    objs = ds.load_objects()
    for c in ds.commits:
        if not os.path.exists(ds.labels_path(c.index)):
            raise PipelineError(f"{ds.labels_path(c.index)} not found: run the diff step first")
    os.makedirs(os.path.join(ds.pub_dir, "commits"), exist_ok=True)
    W = world_from_ref(np.array(TJ["ref_canon"]), ds.calibration_m)
    commits = []
    for c in ds.commits:
        commits.append(bake_commit(ds, c, W @ np.array(TJ["transforms"][f"c{c.index}"]), params))
    objects = []
    for o in objs["objects"]:
        name = ds.object_names.get(o["id"], f"Object {o['id']:02d}")
        objects.append({**o, "name": name})
    # the room box (walls, floor, ceiling) is axis-aligned in the canonical frame; the viewer frames the camera with it
    world_from_canon = W @ np.linalg.inv(np.array(TJ["ref_canon"]))
    lo, hi = np.array(objs["room_canon"])
    corners = np.array([[x, y, z, 1.0] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]) @ world_from_canon.T
    room = [corners[:, :3].min(axis=0).round(4).tolist(), corners[:, :3].max(axis=0).round(4).tolist()]
    manifest = {"commits": commits, "voxel": objs["voxel"], "origin": objs["origin"], "shape": objs["shape"], "room": room,
                "world_from_ref": W.tolist(), "calibration_m": ds.calibration_m, "objects": objects}
    path = os.path.join(ds.pub_dir, "commits.json")
    with open(path, "w") as fh:
        json.dump(manifest, fh, indent=1)
    log.info(f"wrote {path}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if len(sys.argv) != 2:
        sys.exit("usage: python3 bake.py <set-name>")
    try:
        run(Dataset(sys.argv[1]))
    except PipelineError as e:
        sys.exit(f"bake: {e}")
