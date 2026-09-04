"""
bake:    apply the registration to each raw .ply, write the aligned .ply, compress it to .spz with Spark's own
         SpzWriter (splat-transform 3.x writes SPZ v4, which Spark 2.1 does not read), then publish.
publish: copy the label grids and write viewer/public/sets/<name>/commits.json from out/objects.json plus the
         curation in dataset.json (object names, excluded objects). Needs the .spz files but not the captures,
         so renaming or excluding an object is `run.py <set> --only publish`, seconds not minutes.

World frame for the viewer: c0 raw -> canonical unit room frame (z up, floor at z = 0; from register.py)
-> metres (calibration_m) -> y-up (three.js). Object boxes are axis-aligned in the canonical (room) frame, so
they stay tight in world space: world_from_canon is a scale and an axis permutation, nothing rotates.
"""
import gzip
import hashlib
import json
import logging
import os
import struct
import subprocess
import sys

import numpy as np

from dataset import Dataset, PipelineError, ROOT
from splat_io import read_ply, sh_band_count, transform_raw, write_ply

log = logging.getLogger("bake")

PLY2SPZ = os.path.join(ROOT, "viewer", "ply2spz.mjs")
Z_UP_TO_Y_UP = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)
SPZ_MAGIC = 0x5053474E  # "NGSP"


def world_from_ref(ref_canon, calibration_m):
    return world_from_canon(calibration_m) @ ref_canon


def world_from_canon(calibration_m):
    return Z_UP_TO_Y_UP @ np.diag([calibration_m, calibration_m, calibration_m, 1.0])


def box_to_world(lo, hi, M):
    """Axis-aligned box under an axis-aligned transform: map the corners, take the extent."""
    corners = np.array([[x, y, z, 1.0] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]) @ M.T
    return [corners[:, :3].min(axis=0).round(4).tolist(), corners[:, :3].max(axis=0).round(4).tolist()]


def ply_to_spz(aligned, spz, sh):
    result = subprocess.run(["node", PLY2SPZ, aligned, spz, str(sh)], capture_output=True, text=True)
    if result.returncode:
        raise PipelineError(f"ply2spz failed on {aligned} (exit {result.returncode}):\n{result.stderr.strip()}")
    for line in result.stderr.strip().splitlines():
        log.warning(f"  ply2spz: {line}")
    if result.stdout.strip():
        log.info(f"  {result.stdout.strip()}")


def spz_splats(spz):
    """Point count from the SPZ header (gzip: magic u32, version u32, numPoints u32, ...)."""
    with gzip.open(spz, "rb") as fh:
        head = fh.read(12)
    if len(head) < 12:
        raise PipelineError(f"{spz}: truncated header")
    magic, _version, n = struct.unpack("<III", head)
    if magic != SPZ_MAGIC:
        raise PipelineError(f"{spz}: not an SPZ file (magic {magic:#x})")
    return int(n)


def spz_path(ds, i):
    return os.path.join(ds.pub_dir, "commits", f"c{i}.spz")


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
    spz = spz_path(ds, commit.index)
    ply_to_spz(aligned, spz, params.sh)
    log.info(f"c{commit.index}  {len(d['raw']):>9,} -> {len(raw):>9,} splats (pruned <{params.prune_opacity})   "
             f"spz {os.path.getsize(spz) / 1e6:5.1f} MB")


def run(ds):
    TJ = ds.load_transforms()
    ds.load_objects()
    for c in ds.commits:
        if not os.path.exists(ds.labels_path(c.index)):
            raise PipelineError(f"{ds.labels_path(c.index)} not found: run the diff step first")
    os.makedirs(os.path.join(ds.pub_dir, "commits"), exist_ok=True)
    W = world_from_ref(np.array(TJ["ref_canon"]), ds.calibration_m)
    for c in ds.commits:
        bake_commit(ds, c, W @ np.array(TJ["transforms"][f"c{c.index}"]), ds.bake)
    publish(ds)


def publish(ds):
    TJ = ds.load_transforms()
    objs = ds.load_objects()
    for c in ds.commits:
        if not os.path.exists(spz_path(ds, c.index)):
            raise PipelineError(f"{spz_path(ds, c.index)} not found: run the bake step first")
        if not os.path.exists(ds.labels_path(c.index)):
            raise PipelineError(f"{ds.labels_path(c.index)} not found: run the diff step first")
    if any("bbox_canon" not in o for o in objs["objects"]):
        raise PipelineError(f"{ds.objects_path} predates room-aligned object boxes: re-run the diff step")
    os.makedirs(os.path.join(ds.pub_dir, "commits"), exist_ok=True)
    W = world_from_ref(np.array(TJ["ref_canon"]), ds.calibration_m)
    WC = world_from_canon(ds.calibration_m)

    # curation: drop excluded objects, renumber the rest compactly (the viewer indexes objects by id)
    known = {o["id"] for o in objs["objects"]}
    for oid in sorted(ds.exclude | set(ds.object_names)):
        if oid not in known:
            raise PipelineError(f"{ds.json_path}: object {oid} does not exist (ids: 0…{len(known) - 1})")
    kept = [o for o in objs["objects"] if o["id"] not in ds.exclude]
    new_id = {o["id"]: i for i, o in enumerate(kept)}
    remap = lambda old: None if old is None else new_id.get(old)     # a move to/from an excluded object is dropped
    # the tracker pairs moves by size alone; a thing keeps its name when it moves, so different names = not a move
    by_id = {o["id"]: o for o in objs["objects"]}
    label = lambda oid: ds.object_names.get(oid, {}).get("name")
    for o in kept:
        src = o["moved_from"]
        if src is not None and label(src) is not None and label(o["id"]) is not None and label(src) != label(o["id"]):
            log.info(f"move #{src} → #{o['id']} severed: {label(src)} is not {label(o['id'])}")
            o["moved_from"] = None
            if src in by_id and by_id[src]["moved_to"] == o["id"]:
                by_id[src]["moved_to"] = None
    objects = []
    for o in kept:
        lo, hi = o["bbox_canon"]
        nid = new_id[o["id"]]
        meta = ds.object_names.get(o["id"], {})
        objects.append({"id": nid, "source_id": o["id"], "name": meta.get("name", f"Object {nid:02d}"),
                        "kind": meta.get("kind", "thing"), "sub": meta.get("sub"), "doc": meta.get("doc"),
                        "added_in": o["added_in"], "removed_in": o["removed_in"], "present": o["present"],
                        "voxels": o["voxels"], "volume_vox_m3": o["volume_vox_m3"],
                        "moved_from": remap(o["moved_from"]), "moved_to": remap(o["moved_to"]),
                        "bbox": box_to_world(lo, hi, WC)})
    if ds.exclude:
        moved = [f"#{o['id']}→#{new_id[o['id']]}" for o in kept if new_id[o["id"]] != o["id"]]
        log.info(f"excluded {', '.join(f'#{i}' for i in sorted(ds.exclude))}; {len(objects)} objects published; "
                 f"renumbered {', '.join(moved) or 'none'} (dataset.json keeps using the diff's ids; "
                 f"commits.json carries them as source_id)")
    lut = np.zeros(len(known) + 1, np.uint16)
    for old, new in new_id.items():
        lut[old + 1] = new + 1

    commits = []
    n_vox = int(np.prod(objs["shape"]))
    for c in ds.commits:
        spz = spz_path(ds, c.index)
        with open(spz, "rb") as fh:
            digest = hashlib.sha1(fh.read()).hexdigest()[:7]
        with gzip.open(ds.labels_path(c.index), "rb") as fh:
            labels = np.frombuffer(fh.read(), np.uint16)
        if len(labels) != n_vox:
            raise PipelineError(f"{ds.labels_path(c.index)}: {len(labels)} voxels, objects.json shape says {n_vox}")
        if labels.max() > len(known):
            raise PipelineError(f"{ds.labels_path(c.index)}: label {labels.max()} exceeds the object count; re-run the diff step")
        with gzip.open(os.path.join(ds.pub_dir, "commits", f"c{c.index}.labels.bin"), "wb", compresslevel=6) as fh:
            fh.write(np.ascontiguousarray(lut[labels]).tobytes())
        commits.append({"id": f"c{c.index}", "index": c.index, "hash": digest, "message": c.message,
                        "captured": c.captured, "file": f"commits/c{c.index}.spz", "splats": spz_splats(spz),
                        "labels": f"commits/c{c.index}.labels.bin"})
        log.info(f"c{c.index}  {commits[-1]['splats']:>9,} splats   {digest}")

    # the room box (walls, floor, ceiling) is axis-aligned in the canonical frame; the viewer frames the camera with it
    lo, hi = objs["room_canon"]
    manifest = {"commits": commits, "voxel": objs["voxel"], "origin": objs["origin"], "shape": objs["shape"],
                "room": box_to_world(lo, hi, WC), "world_from_ref": W.tolist(), "calibration_m": ds.calibration_m,
                "door": ds.door, "objects": objects}
    path = os.path.join(ds.pub_dir, "commits.json")
    with open(path, "w") as fh:
        json.dump(manifest, fh, indent=1)
    log.info(f"wrote {path}  ({len(objects)} objects)")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if len(sys.argv) != 2:
        sys.exit("usage: python3 bake.py <set-name>")
    try:
        run(Dataset(sys.argv[1]))
    except PipelineError as e:
        sys.exit(f"bake: {e}")
