#!/usr/bin/env python3
"""
End-to-end check of the pipeline on the synthetic garage. Plain script: exits non-zero if any check fails.
(--check-only skips steps 1 and 2 and re-checks the existing outputs.)

  1. python3 pipeline/make_synthetic.py           (writes data/sets/synthetic/)
  2. python3 pipeline/run.py synthetic            (register -> diff -> bake, the CLI users run)
  3. asserts, against data/sets/synthetic/truth.json:
     - the viewer manifest keeps its contract (keys, label grid sizes)
     - registration: the 8 room corners land within 15 mm (mean, real-world) of where truth.frame puts them
     - the viewer world frame is metric, y-up, floor at y = 0
     - every truth object is found in every commit it is present in: parts holding >= 75% of its points
       (skipping parts that lie in the floor band, which the diff rejects by design) have their centre inside
       the bbox of a detected object present in that commit
     - no detected object lies entirely below the floor or above the ceiling
     - "Work in progress" has identical geometry in c4 and c5 (the generator's RNG fix)
"""
import gzip
import json
import os
import subprocess
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SET = os.path.join(ROOT, "data", "sets", "synthetic")
PUB = os.path.join(ROOT, "viewer", "public", "sets", "synthetic")
MAX_REGISTRATION_MM = 15.0
FLOOR_BAND_M = 0.15          # parts whose top is below this are floor patches to the diff, by design
MIN_POINTS_COVERED = 0.75    # fraction of a truth object's (non-floor) points whose part centre must be inside a bbox

failures = []


def check(ok, message):
    print(("  ok    " if ok else "  FAIL  ") + message)
    if not ok:
        failures.append(message)


def frame(commit):
    f = commit["frame"]
    M = np.eye(4)
    M[:3, :3] = f["scale"] * np.array(f["R"])
    M[:3, 3] = f["t"]
    return M


def apply(P, T):
    return P @ T[:3, :3].T + T[:3, 3]


def main():
    steps = [] if "--check-only" in sys.argv else [["make_synthetic.py"], ["run.py", "synthetic"]]
    for cmd in steps:
        print(f"\n$ python3 pipeline/{' '.join(cmd)}", flush=True)
        r = subprocess.run([sys.executable, os.path.join(ROOT, "pipeline", cmd[0])] + cmd[1:])
        if r.returncode:
            sys.exit(f"FAIL: {cmd[0]} exited with {r.returncode}")

    truth = json.load(open(os.path.join(SET, "truth.json")))
    transforms = json.load(open(os.path.join(SET, "out", "transforms.json")))
    manifest = json.load(open(os.path.join(PUB, "commits.json")))
    W, D, H = truth["room_m"]
    F0 = frame(truth["commits"][0])
    s0 = truth["commits"][0]["frame"]["scale"]
    ref_canon = np.array(transforms["ref_canon"])
    calibration_m = manifest["calibration_m"]
    print("\n--- manifest contract")
    check(set(manifest) >= {"commits", "objects", "voxel", "origin", "shape", "room", "world_from_ref", "calibration_m"},
          "commits.json has the viewer's top-level keys")
    n_vox = int(np.prod(manifest["shape"]))
    for c in manifest["commits"]:
        check(set(c) >= {"id", "index", "hash", "message", "captured", "file", "splats", "labels"}, f"{c['id']} commit keys")
        check(os.path.exists(os.path.join(PUB, c["file"])), f"{c['file']} exists")
        with gzip.open(os.path.join(PUB, c["labels"]), "rb") as fh:
            labels = np.frombuffer(fh.read(), np.uint16)
        check(len(labels) == n_vox, f"{c['labels']} holds {len(labels)} = shape voxels ({n_vox})")
        check(labels.max() <= len(manifest["objects"]), f"{c['labels']} values are object id + 1")
    for o in manifest["objects"]:
        check(set(o) >= {"id", "name", "added_in", "removed_in", "present", "bbox", "voxels", "volume_vox_m3"},
              f"object {o['id']} keys")

    print("\n--- registration (8 room corners vs truth frames)")
    corners = np.array([[sx * W / 2, sy * D / 2, z] for sx in (-1, 1) for sy in (-1, 1) for z in (0, H)])
    ref_corners = apply(corners, F0)
    for tc in truth["commits"][1:]:
        T = np.array(transforms["transforms"][f"c{tc['index']}"])
        est = apply(apply(corners, frame(tc)), T)
        err_mm = np.linalg.norm(est - ref_corners, axis=1).mean() / s0 * 1000
        check(err_mm < MAX_REGISTRATION_MM, f"c{tc['index']}: mean corner error {err_mm:.1f} mm < {MAX_REGISTRATION_MM} mm")

    print("\n--- world frame (metric, y up, floor at y = 0)")
    world = apply(ref_corners, np.array(manifest["world_from_ref"]))
    floor_y = world[corners[:, 2] == 0][:, 1]
    ceiling_y = world[corners[:, 2] == H][:, 1]
    check(np.abs(floor_y).max() < 0.05 * H, f"floor corners at y = {floor_y.round(3).tolist()} (expect 0)")
    check(np.abs(ceiling_y - H).max() < 0.05 * H, f"ceiling corners at y = {ceiling_y.round(3).tolist()} (expect {H})")
    room = np.array(manifest["room"])
    room_size = np.sort(room[1] - room[0])                  # y is up in world, so sorted = (H, min(W,D), max(W,D))
    check(np.allclose(room_size, sorted([W, D, H]), rtol=0.06), f"manifest room box {room_size.round(2).tolist()} ≈ {sorted([W, D, H])} m")
    check(abs(room[0][1]) < 0.05 * H, f"room floor at y = {room[0][1]:.3f} (expect 0)")
    long_span = np.linalg.norm(world[0] - world[2])       # (-W/2,-D/2,0) -> (-W/2,+D/2,0)
    check(abs(long_span - D) < 0.05 * D, f"long wall {long_span:.3f} m (expect {D})")

    print("\n--- objects: truth parts inside detected bboxes, per commit")
    objects = manifest["objects"]
    boxes = [(np.array(o["bbox"][0]), np.array(o["bbox"][1]), set(o["present"]), o["id"]) for o in objects]
    for t in truth["objects"]:
        for ci in t["commits"]:
            parts = [p for p in t["parts"][str(ci)] if p["top"] >= FLOOR_BAND_M]
            covered = 0
            hits = set()
            for p in parts:
                centre = apply(np.array([p["centre"]]), F0)[0]
                inside = [oid for lo, hi, present, oid in boxes
                          if ci in present and np.all(centre >= lo) and np.all(centre <= hi)]
                if inside:
                    covered += p["points"]
                    hits.update(inside)
            frac = covered / sum(p["points"] for p in parts)
            check(frac >= MIN_POINTS_COVERED,
                  f"{t['name']:18s} c{ci}: {frac:.0%} of its points in parts inside detected objects {sorted(hits)}")

    print("\n--- no detected object entirely below the floor or above the ceiling")
    for o in objects:
        lo, hi = np.array(o["bbox"])
        corners8 = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
        z_m = apply(corners8, ref_canon)[:, 2] * calibration_m
        check(z_m.max() > 0 and z_m.min() < H, f"object {o['id']:2d} spans {z_m.min():.2f}..{z_m.max():.2f} m above the floor")

    print("\n--- generator: 'Work in progress' geometry is identical in c4 and c5")
    wip = next(t for t in truth["objects"] if t["name"] == "Work in progress")
    c4 = [p["centre"] for p in wip["parts"]["4"]]
    c5 = [p["centre"] for p in wip["parts"]["5"]]
    check(c4 == c5, f"{len(c4)} part centres match")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print("  - " + f)
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main()
