"""
Voxel-occupancy diff between registered commits.

  occ[c]       : bool grid, voxel = VOX (in ref units); a voxel is on if it holds enough solid splats
  added(a,b)   = occ[b] & (distance to occ[a] > JITTER)      (jitter absorbs registration + reconstruction slop)
  removed(a,b) = occ[a] & (distance to occ[b] > JITTER)
  then: dilate (bridges the 1-voxel shells splat surfaces produce) -> connected components -> filter:
        too small / unobserved by the other capture / floor patch / too close to a wall
Objects are tracked across the whole timeline:
  - a removal that overlaps a live object shrinks it; the object closes when < 30% of it remains
  - an unmatched removal is an object that was there before we noticed: its first commit is found by
    scanning earlier occupancies backwards (an "original" only if c0 held >= 50% of its voxels)
  - a removal and an addition of similar size in the same step are recorded as a move (moved_from / moved_to)
Label grids: per commit a uint16 grid (value = object id + 1, 0 = static). Each object's label support is
its blob grown through the commit's occupancy (above the floor, not through static geometry), then dilated.

Writes out/objects.json and out/c<i>.labels.bin (gzipped uint16, C order).
"""
import gzip
import json
import logging
import sys
import time
from collections import Counter

import numpy as np
from scipy import ndimage

from dataset import Dataset, PipelineError
from splat_io import read_ply

log = logging.getLogger("diff")

STRUCT_6 = ndimage.generate_binary_structure(3, 1)      # face neighbours
STRUCT_26 = np.ones((3, 3, 3), bool)                    # face + edge + corner neighbours
PARTIAL_OVERLAP = 0.2       # a removal blob overlapping a live object by this fraction of the blob belongs to it
CLOSE_REMAINING = 0.3       # an object closes when less than this fraction of its voxels remain
ORIGINAL_OCCUPIED = 0.5     # an object existed in an earlier commit if that commit held this fraction of its voxels
MOVE_SIZE_TOL = 0.3         # removed/added blobs within this relative size count as one object moving
MIN_LABEL_HEIGHT = 0.5      # voxels above the floor a voxel must be to join an object's label support


class Grid:
    """The voxel grid shared by all commits, with per-voxel room geometry in the reference's canonical frame."""

    def __init__(self, room0, ref_canon, vox, calibration_m):
        self.vox = vox
        self.ref_canon = ref_canon
        lo = np.percentile(room0, 1, axis=0)
        hi = np.percentile(room0, 99, axis=0)
        pad = (hi - lo) * 0.08
        self.origin = lo - pad - 2 * vox
        self.shape = tuple(int(x) for x in np.ceil((hi + pad + 2 * vox - self.origin) / vox).astype(int) + 1)
        self.calibration_m = calibration_m
        span = float(np.abs(np.linalg.det(ref_canon[:3, :3])) ** (-1 / 3))
        self.m_per_ref = calibration_m / span                                  # metres per reference unit
        centres = self.origin + (np.indices(self.shape).reshape(3, -1).T + 0.5) * vox
        canon = centres @ ref_canon[:3, :3].T + ref_canon[:3, 3]
        self.height_vox = (canon[:, 2] * span / vox).reshape(self.shape)      # voxels above the floor plane
        self.xy_canon = canon[:, :2].reshape(*self.shape, 2)
        q0 = room0 @ ref_canon[:3, :3].T + ref_canon[:3, 3]
        self.room_lo = np.percentile(q0[:, :2], 2, axis=0)                     # walls, canonical xy
        self.room_hi = np.percentile(q0[:, :2], 98, axis=0)
        ceiling = float(np.percentile(q0[:, 2], 98))
        self.room_canon = [[*self.room_lo.tolist(), 0.0], [*self.room_hi.tolist(), ceiling]]   # floor at z = 0

    def occupancy(self, xyz, opacity, params):
        ijk = np.floor((xyz - self.origin) / self.vox).astype(np.int64)
        ok = np.all((ijk >= 0) & (ijk < self.shape), axis=1)
        solid = ok & (opacity > params.opacity_solid)
        flat = np.ravel_multi_index(tuple(ijk[solid].T), self.shape)
        count = np.bincount(flat, minlength=int(np.prod(self.shape))).reshape(self.shape)
        return count >= params.min_count

    def bbox_ref(self, ijk_lo, ijk_hi):
        lo = self.origin + np.asarray(ijk_lo) * self.vox
        hi = self.origin + (np.asarray(ijk_hi) + 1) * self.vox
        return [lo.round(3).tolist(), hi.round(3).tolist()]


def room_points(xyz, opacity, ref_canon):
    """Solid splats inside the room, judged in the canonical unit frame (drops background splats)."""
    p = xyz[opacity > .35]
    q = p @ ref_canon[:3, :3].T + ref_canon[:3, 3]
    return p[np.all(np.abs(q) < 0.75, axis=1)]


def load_commit(ds, index, transforms):
    """Positions (in the reference frame) and opacities of one commit; nothing else is retained."""
    d = read_ply(ds.raw_ply(index))
    M = np.array(transforms[f"c{index}"])
    return d["xyz"] @ M[:3, :3].T + M[:3, 3], d["opacity"]


def distance_to(mask):
    """Euclidean distance (in voxels) from every voxel to the nearest voxel of mask."""
    return ndimage.distance_transform_edt(~mask)


def components(mask, seen, grid, params, what):
    """Splat surfaces are thin shells: never erode them. Dilate to bridge gaps, label, filter by the ORIGINAL
    mask's voxel count, and drop candidates that lie almost entirely where the other capture has nothing nearby
    (unobserved, not changed), floor patches, and near-wall blobs. Returns labels on the dilated support."""
    grown = ndimage.binary_dilation(mask, STRUCT_26)
    lab, n = ndimage.label(grown, structure=STRUCT_26)
    if n == 0:
        return lab, 0
    core = np.where(mask, lab, 0)                      # labels restricted to the original mask
    index = np.arange(1, n + 1)
    size = ndimage.sum(mask, core, index)
    covered = ndimage.sum(seen, core, index)
    near_floor = ndimage.sum(np.abs(grid.height_vox) <= params.floor_band_voxels, core, index)
    median_height = np.array(ndimage.median(grid.height_vox, core, index))
    cx = np.array(ndimage.mean(grid.xy_canon[..., 0], core, index))
    cy = np.array(ndimage.mean(grid.xy_canon[..., 1], core, index))
    reject = Counter()
    keep = []
    for i in range(n):
        if size[i] < params.min_voxels:
            reject["size"] += 1
        elif covered[i] < params.coverage_frac * size[i]:
            reject["coverage"] += 1
        elif near_floor[i] / size[i] >= params.floor_frac or median_height[i] <= params.floor_band_voxels:
            reject["floor"] += 1
        elif params.wall_margin_m and _near_wall(cx[i], cy[i], grid, params):
            reject["wall"] += 1
        else:
            keep.append(i + 1)
    lut = np.zeros(n + 1, np.int32)
    lut[keep] = np.arange(1, len(keep) + 1)
    log.info(f"  {what}: {len(keep)} kept of {n} candidates; rejected size {reject['size']}, "
             f"coverage {reject['coverage']}, floor {reject['floor']}, wall {reject['wall']}")
    return lut[lab], len(keep)


def _near_wall(cx, cy, grid, params):
    """Centroid (canonical xy) within wall_margin_m of a wall; one canonical unit is calibration_m metres."""
    margin = params.wall_margin_m / grid.calibration_m
    c = np.array([cx, cy])
    return bool(np.any(c < grid.room_lo + margin) or np.any(c > grid.room_hi - margin))


def grow_support(seed, growable_labels):
    """Seed plus every connected component of the growable set the seed touches."""
    hit = np.unique(growable_labels[seed])
    hit = hit[hit > 0]
    if len(hit) == 0:
        return seed.copy()
    lut = np.zeros(growable_labels.max() + 1, bool)
    lut[hit] = True
    return seed | lut[growable_labels]


def label_reach(support, blocked, params):
    """Where an object's label applies: its support, plus a dilation that stops at blocked voxels."""
    grown = ndimage.binary_dilation(support, STRUCT_6, iterations=params.label_dilate_voxels)
    return support | (grown & ~blocked)


class Tracker:
    """Objects across the timeline, plus the per-commit label grids."""

    def __init__(self, grid, occ, params):
        self.grid = grid
        self.occ = occ
        self.params = params
        self.objects = []
        self.live = {}                  # object id -> voxel mask on the dilated support
        self.labels = []                # per commit: uint16 grid, value = object id + 1

    def new_object(self, mask, added_in, removed_in, present):
        ijk = np.argwhere(mask)
        o = {"id": len(self.objects), "added_in": added_in, "removed_in": removed_in, "present": list(present),
             "voxels": int(mask.sum()), "bbox_vox": [ijk.min(0).tolist(), ijk.max(0).tolist()],
             "moved_from": None, "moved_to": None}
        self.objects.append(o)
        return o["id"]

    def first_commit(self, core, ci):
        """Earliest commit, scanning back from ci-1, that still held most of these voxels."""
        added_in = ci - 1
        for cj in range(ci - 2, -1, -1):
            if self.occ[cj][core].mean() >= ORIGINAL_OCCUPIED:
                added_in = cj
            else:
                break
        return added_in

    def step(self, ci, dist_prev, dist_cur):
        """Detect changes between commits ci-1 and ci and update the object list."""
        p = self.params
        a = self.occ[ci - 1]
        b = self.occ[ci]
        added = b & (dist_prev > p.jitter_voxels)
        removed = a & (dist_cur > p.jitter_voxels)
        labA, nA = components(added, dist_prev <= p.coverage_voxels, self.grid, p, f"c{ci - 1}->c{ci} added")
        labR, nR = components(removed, dist_cur <= p.coverage_voxels, self.grid, p, f"c{ci - 1}->c{ci} removed")
        closed = []
        for k in range(1, nR + 1):
            m = labR == k
            n_m = int(m.sum())
            hits = [oid for oid, g in self.live.items()
                    if (g & m).sum() > PARTIAL_OVERLAP * min(n_m, g.sum())]      # one blob can take several objects
            for hit in hits:
                g = self.live[hit]
                g &= ~m
                g &= dist_cur <= p.jitter_voxels                # what is left must still be there in this commit
                remaining = g.sum() / self.objects[hit]["voxels"]
                if remaining < CLOSE_REMAINING:
                    self.objects[hit]["removed_in"] = ci
                    del self.live[hit]
                    closed.append(hit)
                else:
                    log.info(f"  object {hit}: partial removal, {remaining:.0%} remains")
            if hits:
                continue
            added_in = self.first_commit(m & removed, ci)
            oid = self.new_object(m, added_in, ci, range(added_in, ci))
            self.backfill(oid, m, added_in, ci, dist_cur)
            closed.append(oid)
        opened = []
        for k in range(1, nA + 1):
            m = labA == k
            oid = self.new_object(m, ci, None, [ci])
            self.live[oid] = m
            opened.append(oid)
        self.match_moves(closed, opened)
        for oid in self.live:
            if ci not in self.objects[oid]["present"]:
                self.objects[oid]["present"].append(ci)
        log.info(f"c{ci - 1}->c{ci}: {nA} added, {nR} removed components")

    def match_moves(self, closed, opened):
        """Pair removed and added blobs of similar voxel count (one to one, closest size first)."""
        pairs = []
        for r in closed:
            for a in opened:
                vr = self.objects[r]["voxels"]
                va = self.objects[a]["voxels"]
                if abs(va - vr) <= MOVE_SIZE_TOL * vr:
                    pairs.append((abs(va - vr) / vr, r, a))
        used = set()
        for _, r, a in sorted(pairs):
            if r in used or a in used:
                continue
            used.update((r, a))
            self.objects[r]["moved_to"] = a
            self.objects[a]["moved_from"] = r
            log.info(f"  object {r} -> {a}: moved (removed and added in the same step, similar size)")

    def backfill(self, oid, blob, added_in, removed_in, dist_after):
        """Label an object discovered by its removal in every earlier commit it was present in. What remains
        after the removal is the static geometry the label must not grow into, nor may it take voxels that
        those commits already gave to other objects."""
        static = dist_after <= 1
        for cj in range(added_in, removed_in):
            lab = self.labels[cj]
            blocked = static | (lab != 0)
            growable = self.occ[cj] & (self.grid.height_vox > MIN_LABEL_HEIGHT) & ~blocked
            comp, _ = ndimage.label(growable, structure=STRUCT_26)
            reach = label_reach(grow_support(blob, comp), blocked, self.params)
            lab[reach & (lab == 0)] = oid + 1

    def label_commit(self, ci, dist_prev):
        """Label grid for commit ci from the live objects. Each object's support grows from its blob through
        the commit's occupancy above the floor, but not into static geometry (the previous commit's dilated
        occupancy, minus what was labelled as this object there) nor into other objects' blobs."""
        lab = np.zeros(self.grid.shape, np.uint16)
        if ci > 0:
            prev_near = dist_prev <= 1
            prev_lab = self.labels[ci - 1]
        else:
            prev_near = np.zeros(self.grid.shape, bool)
            prev_lab = lab
        base = self.occ[ci] & (self.grid.height_vox > MIN_LABEL_HEIGHT)
        all_seeds = np.zeros(self.grid.shape, bool)
        for g in self.live.values():
            all_seeds |= g
        for oid, g in self.live.items():
            blocked = (prev_near & (prev_lab != oid + 1)) | (all_seeds & ~g)
            comp, _ = ndimage.label(base & ~blocked, structure=STRUCT_26)
            reach = label_reach(grow_support(g, comp), blocked, self.params)
            lab[reach & (lab == 0)] = oid + 1
        self.labels.append(lab)


def run(ds):
    t0 = time.time()
    p = ds.diff
    TJ = ds.load_transforms()
    ref_canon = np.array(TJ["ref_canon"])
    transforms = TJ["transforms"]
    span = float(np.abs(np.linalg.det(ref_canon[:3, :3])) ** (-1 / 3))       # canonical frame divides by the room span
    vox = p.voxel_frac * span
    xyz0, opacity0 = load_commit(ds, 0, transforms)
    grid = Grid(room_points(xyz0, opacity0, ref_canon), ref_canon, vox, ds.calibration_m)
    if p.wall_margin_m:
        log.info(f"wall margin {p.wall_margin_m} m -> ignoring objects within {p.wall_margin_m / ds.calibration_m:.3f} "
                 f"of the room edge (canonical)")
    log.info(f"voxel {vox:.4f} ref-units ({vox * grid.m_per_ref * 100:.1f} cm)  min blob {p.min_voxels} vox  "
             f"grid {grid.shape} ({np.prod(grid.shape) / 1e6:.1f} M voxels)")
    occ = [grid.occupancy(xyz0, opacity0, p)]
    del xyz0, opacity0
    for c in ds.commits[1:]:
        xyz, opacity = load_commit(ds, c.index, transforms)
        occ.append(grid.occupancy(xyz, opacity, p))
        del xyz, opacity
    tracker = Tracker(grid, occ, p)
    dist_prev = None
    dist_cur = distance_to(occ[0])
    for ci in range(len(occ)):
        if ci > 0:
            dist_prev = dist_cur
            dist_cur = distance_to(occ[ci])
            tracker.step(ci, dist_prev, dist_cur)
        tracker.label_commit(ci, dist_prev)
    objects = tracker.objects
    for o in objects:
        ijk_lo, ijk_hi = o.pop("bbox_vox")
        o["bbox"] = grid.bbox_ref(ijk_lo, ijk_hi)
        o["volume_vox_m3"] = round(o["voxels"] * (vox * grid.m_per_ref) ** 3, 4)
    for ci, lab in enumerate(tracker.labels):
        with gzip.open(ds.labels_path(ci), "wb", compresslevel=6) as fh:
            fh.write(np.ascontiguousarray(lab).tobytes())
    with open(ds.objects_path, "w") as fh:
        json.dump({"voxel": vox, "origin": grid.origin.tolist(), "shape": list(grid.shape),
                   "room_canon": grid.room_canon, "objects": objects},
                  fh, indent=1)
    log.info(f"\n{len(objects)} objects:")
    for o in objects:
        removed = f"c{o['removed_in']}" if o["removed_in"] is not None else "—"
        moved = ""
        if o["moved_from"] is not None:
            moved = f"  moved from #{o['moved_from']}"
        if o["moved_to"] is not None:
            moved = f"  moved to #{o['moved_to']}"
        log.info(f"  #{o['id']:>2}  added c{o['added_in']}  removed {removed:>3}  present {o['present']}  "
                 f"{o['voxels']:>5} vox  {o['volume_vox_m3']:.3f} m3{moved}")
    log.info(f"diff done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if len(sys.argv) != 2:
        sys.exit("usage: python3 diff.py <set-name>")
    try:
        run(Dataset(sys.argv[1]))
    except PipelineError as e:
        sys.exit(f"diff: {e}")
