"""
Voxel-occupancy diff between registered commits.

  occupancy[c] : bool grid, voxel = VOX (in ref units), a voxel is on if it holds enough splat mass
  added(a,b)   = occ[b] & ~dilate(occ[a])      (dilate absorbs registration + reconstruction jitter)
  removed(a,b) = occ[a] & ~dilate(occ[b])
  then: binary opening (kills speckle) -> connected components -> drop blobs below MIN_VOXELS
Objects are tracked across the whole timeline: a component in commit N that overlaps a
component in commit N-1 is the same object.
Writes data/out/objects.json and per-commit per-splat status (0 same / 1 added / 2 removed vs previous).
"""
import numpy as np, json, os
from scipy import ndimage
from splat_io import read_ply
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RAW = os.path.join(ROOT, "data", "raw"); OUT = os.path.join(ROOT, "data", "out")
VOX = None            # set adaptively from splat spacing (see choose_voxel); ref units
MIN_VOLUME = 0.0015   # smallest blob we report, in ref units^3 (~1.5 L real if ref scale ~1)
MIN_VOXELS = None     # derived from MIN_VOLUME / VOX^3
JITTER = 1            # dilation radius (voxels) tolerated before something counts as changed

def load_all():
    T = json.load(open(f"{OUT}/transforms.json"))["transforms"]
    cs = []
    for ci in range(6):
        d = read_ply(f"{RAW}/c{ci}.ply"); M = np.array(T[f"c{ci}"])
        d["xyz"] = d["xyz"] @ M[:3,:3].T + M[:3,3]
        cs.append(d)
    return cs

def choose_voxel(cs):
    """3x the median nearest-neighbour spacing of solid splats: a surface voxel then holds ~5-10 splats."""
    from scipy.spatial import cKDTree
    spac = []
    for c in cs:
        p = c["xyz"][c["opacity"] > .5]; p = p[np.random.default_rng(0).choice(len(p), min(60000, len(p)), replace=False)]
        d, _ = cKDTree(p).query(p, k=2, workers=-1); spac.append(np.median(d[:, 1]))
    return float(3.0 * np.median(spac))

def grid_shape(cs):
    allp = np.vstack([c["xyz"] for c in cs]); lo = np.percentile(allp, 0.2, axis=0) - 2*VOX
    hi = np.percentile(allp, 99.8, axis=0) + 2*VOX
    return lo, np.ceil((hi - lo) / VOX).astype(int) + 1

def occupancy(c, lo, shape):
    ijk = np.floor((c["xyz"] - lo) / VOX).astype(int)
    ok = np.all((ijk >= 0) & (ijk < shape), axis=1)
    mass = np.zeros(shape); np.add.at(mass, tuple(ijk[ok].T), c["opacity"][ok])
    # adaptive: occupied = at least a third of the typical mass of a populated voxel in THIS capture
    thr = 0.35 * np.median(mass[mass > 0])
    return mass >= thr, ijk, ok

def components(mask):
    """Splat surfaces are thin shells: never erode them. Dilate to bridge gaps, label, filter by
    the ORIGINAL mask's voxel count, and return labels on the dilated support (for tracking/bbox)."""
    grown = ndimage.binary_dilation(mask, np.ones((3,3,3)), iterations=1)
    lab, n = ndimage.label(grown, structure=np.ones((3,3,3)))
    sizes = ndimage.sum(mask, lab, range(1, n+1))
    keep = [i+1 for i, sz in enumerate(sizes) if sz >= MIN_VOXELS]
    out = np.zeros_like(lab)
    for k, i in enumerate(keep, 1): out[lab == i] = k
    return out, len(keep)

if __name__ == "__main__":
    cs = load_all()
    VOX = choose_voxel(cs); MIN_VOXELS = max(8, int(MIN_VOLUME / VOX**3))
    globals().update(VOX=VOX, MIN_VOXELS=MIN_VOXELS)
    lo, shape = grid_shape(cs)
    print(f"voxel {VOX:.4f} ref-units  min blob {MIN_VOXELS} vox  grid {shape} ({np.prod(shape)/1e6:.1f} M voxels)")
    occ, ijks, oks = zip(*[occupancy(c, lo, shape) for c in cs])
    st = ndimage.generate_binary_structure(3, 1)
    objects = []          # {id, present:[...], bbox}
    live = {}             # object id -> voxel mask on the dilated support (for tracking)
    labels = []           # per commit: uint16 grid, value = object id + 1, 0 = untracked/static
    for ci in range(6):
        if ci > 0:
            a, b = occ[ci-1], occ[ci]
            added   = b & ~ndimage.binary_dilation(a, st, iterations=JITTER)
            removed = a & ~ndimage.binary_dilation(b, st, iterations=JITTER)
            labA, nA = components(added); labR, nR = components(removed)
            for k in range(1, nR+1):                      # removals close live objects, or reveal c0 originals
                m = labR == k; hit = None
                for oid, g in live.items():
                    if (g & m).sum() > 0.2 * m.sum(): hit = oid; break
                if hit is not None:
                    objects[hit]["removed_in"] = ci; del live[hit]
                else:
                    ijk = np.argwhere(m); oid = len(objects)
                    objects.append({"id": oid, "added_in": 0, "removed_in": ci, "present": list(range(0, ci)),
                                    "bbox_vox": [ijk.min(0).tolist(), ijk.max(0).tolist()], "voxels": int(m.sum())})
                    for cj in range(0, ci): labels[cj][m & (labels[cj] == 0)] = oid + 1     # back-fill earlier commits
            for k in range(1, nA+1):
                m = labA == k; ijk = np.argwhere(m); oid = len(objects)
                objects.append({"id": oid, "added_in": ci, "present": [ci],
                                "bbox_vox": [ijk.min(0).tolist(), ijk.max(0).tolist()], "voxels": int(m.sum())})
                live[oid] = m
            for oid in live:
                if ci not in objects[oid]["present"]: objects[oid]["present"].append(ci)
            print(f"c{ci-1}->c{ci}: {nA} added, {nR} removed components")
        lab = np.zeros(shape, np.uint16)
        for oid, g in live.items(): lab[g] = oid + 1
        labels.append(lab)
    # finalize bboxes in ref units
    for o in objects:
        (i0,j0,k0),(i1,j1,k1) = o.pop("bbox_vox")
        o["bbox"] = [(lo + np.array([i0,j0,k0])*VOX).round(3).tolist(), (lo + (np.array([i1,j1,k1])+1)*VOX).round(3).tolist()]
        o["volume_vox_m3"] = round(o["voxels"] * VOX**3, 4)
        o.setdefault("removed_in", None)
    import gzip
    for ci, lab in enumerate(labels):
        with gzip.open(f"{OUT}/c{ci}.labels.bin", "wb", compresslevel=6) as fh: fh.write(np.ascontiguousarray(lab).tobytes())
    json.dump({"voxel": VOX, "origin": lo.tolist(), "shape": [int(x) for x in shape], "objects": objects},
              open(f"{OUT}/objects.json","w"), indent=1)
    print(f"\n{len(objects)} objects:")
    for o in objects: print(f"  #{o['id']:>2}  added c{o['added_in']}  removed {('c'+str(o['removed_in'])) if o['removed_in'] is not None else '—':>3}  present {o['present']}  {o['voxels']:>5} vox")
