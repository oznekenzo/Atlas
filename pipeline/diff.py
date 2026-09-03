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

DATA = os.environ.get("PATINA_DATA", os.path.join(ROOT, "data")); RAW = os.path.join(DATA, "raw"); OUT = os.path.join(DATA, "out")
N_COMMITS = len([f for f in os.listdir(RAW) if f.startswith("c") and f.endswith(".ply") and f[1:-4].isdigit()])
VOX = None            # 0.8% of room span (~5 cm in a garage); set in main
MIN_VOLUME = None     # (5 voxels)^3 — set in main
JITTER = 2            # voxels of positional slop tolerated before something counts as changed (splat surfaces are fuzzy)
COVERAGE = 12         # voxels (~60 cm): "observed" = within this distance of the OTHER capture's geometry
COVERAGE_FRAC = 0.25  # a candidate object survives if this fraction of it is observed (partial floor holes are common)
OPACITY_SOLID = 0.2   # a voxel is occupied if it holds >= MIN_COUNT splats at least this opaque (density-independent)
MIN_COUNT = 2
WALL_MARGIN_M = 0.0   # metres: objects whose centroid lies this close to a wall are ignored (set per dataset)
CAL_M = None
HEIGHT_VOX = None; ROOM_LO = None; ROOM_HI = None
LABEL_DILATE = 2      # voxels: how far an object's label reaches to catch its thin parts (leaves, wire)
FLOOR_BAND = 2        # voxels: a candidate with >= FLOOR_FRAC of its voxels this close to the floor plane is a floor patch, not an object
FLOOR_FRAC = 0.8
MIN_VOXELS = None     # derived from MIN_VOLUME / VOX^3

def load_all():
    TJ = json.load(open(f"{OUT}/transforms.json")); T = TJ["transforms"]
    global REF_CANON; REF_CANON = np.array(TJ["ref_canon"])
    cs = []
    for ci in range(N_COMMITS):
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

def room_points(c):
    """Solid splats inside the room, judged in the registration's canonical unit frame (drops background splats)."""
    p = c["xyz"][c["opacity"] > .35]; q = p @ REF_CANON[:3, :3].T + REF_CANON[:3, 3]
    return p[np.all(np.abs(q) < 0.75, axis=1)]

def grid_shape(cs):
    allp = np.vstack([room_points(c) for c in cs]); lo = np.percentile(allp, 1, axis=0); hi = np.percentile(allp, 99, axis=0)
    pad = (hi - lo) * 0.08; lo -= pad + 2*VOX; hi += pad + 2*VOX
    return lo, np.ceil((hi - lo) / VOX).astype(int) + 1

def occupancy(c, lo, shape):
    ijk = np.floor((c["xyz"] - lo) / VOX).astype(int)
    ok = np.all((ijk >= 0) & (ijk < shape), axis=1)
    solid = ok & (c["opacity"] > OPACITY_SOLID)
    cnt = np.zeros(shape, np.int32); np.add.at(cnt, tuple(ijk[solid].T), 1)
    return cnt >= MIN_COUNT, ijk, ok

def components(mask, seen=None):
    """Splat surfaces are thin shells: never erode them. Dilate to bridge gaps, label, filter by the ORIGINAL mask's
    voxel count, and drop candidates that lie almost entirely where the other capture has nothing nearby
    (unobserved, not changed). Returns labels on the dilated support (for tracking/bbox)."""
    grown = ndimage.binary_dilation(mask, np.ones((3,3,3)), iterations=1)
    lab, n = ndimage.label(grown, structure=np.ones((3,3,3)))
    sizes = ndimage.sum(mask, lab, range(1, n+1))
    keep = []
    for i, sz in enumerate(sizes):
        if sz < MIN_VOXELS: continue
        m = (lab == i+1) & mask
        if seen is not None and (m & seen).sum() < COVERAGE_FRAC * m.sum(): continue
        hm = HEIGHT_VOX[m]
        if (np.abs(hm) <= FLOOR_BAND).mean() >= FLOOR_FRAC or np.median(hm) <= FLOOR_BAND: continue   # floor patch / under-floor fuzz, not an object
        if WALL_MARGIN_M and CAL_M:                                                                   # near-wall objects are out of scope
            c = XY_CANON[m].mean(0); mg = WALL_MARGIN_M / CAL_M
            if np.any(c < ROOM_LO + mg) or np.any(c > ROOM_HI - mg): continue
        keep.append(i+1)
    out = np.zeros_like(lab)
    for k, i in enumerate(keep, 1): out[lab == i] = k
    return out, len(keep)

def load_params():
    """Per-dataset tuning lives in data/<set>/dataset.json, never in code."""
    p = os.path.join(DATA, "dataset.json")
    if not os.path.exists(p): return {}
    return json.load(open(p))

if __name__ == "__main__":
    P = load_params(); dp = P.get("diff", {})
    globals().update(JITTER=int(dp.get("jitter_voxels", JITTER)), COVERAGE=int(dp.get("coverage_voxels", COVERAGE)),
                     COVERAGE_FRAC=float(dp.get("coverage_frac", COVERAGE_FRAC)), OPACITY_SOLID=float(dp.get("opacity_solid", OPACITY_SOLID)),
                     MIN_COUNT=int(dp.get("min_count", MIN_COUNT)), LABEL_DILATE=int(dp.get("label_dilate_voxels", LABEL_DILATE)),
                     FLOOR_BAND=int(dp.get("floor_band_voxels", FLOOR_BAND)), FLOOR_FRAC=float(dp.get("floor_frac", FLOOR_FRAC)),
                     WALL_MARGIN_M=float(dp.get("wall_margin_m", 0.0)), CAL_M=float(P.get("calibration_m", 0) or 0) or None)
    cs = load_all()
    span = float(np.abs(np.linalg.det(REF_CANON[:3, :3])) ** (-1 / 3))       # canonical frame divides by the room span
    VOX = float(dp.get("voxel_frac", 0.008)) * span; MIN_VOXELS = int(dp.get("min_voxels", 60))
    globals().update(VOX=VOX, MIN_VOXELS=MIN_VOXELS)
    lo, shape = grid_shape(cs)
    # signed height of every voxel above the floor plane, in voxels (canonical z, floor = 2nd percentile of solid c0 z, sign resolved by density)
    I, J, K = np.indices(shape); cen = lo + (np.stack([I, J, K], -1).reshape(-1, 3) + .5) * VOX
    zc = (cen @ REF_CANON[:3, :3].T + REF_CANON[:3, 3])[:, 2].reshape(shape)
    q0 = room_points(cs[0]) @ REF_CANON[:3, :3].T + REF_CANON[:3, 3]; zlo, zhi = np.percentile(q0[:, 2], [2, 98]); h = zhi - zlo
    floor_is_high = (q0[:, 2] > zhi - .15 * h).sum() > (q0[:, 2] < zlo + .15 * h).sum()
    floor_z = zhi if floor_is_high else zlo; up = -1.0 if floor_is_high else 1.0
    HEIGHT_VOX = up * (zc - floor_z) / (VOX * float(np.abs(np.linalg.det(REF_CANON[:3, :3])) ** (1 / 3)))   # canonical units per voxel
    ROOM_LO, ROOM_HI = np.percentile(q0[:, :2], 2, axis=0), np.percentile(q0[:, :2], 98, axis=0)               # walls, canonical xy
    XY_CANON = (cen @ REF_CANON[:3, :3].T + REF_CANON[:3, 3])[:, :2].reshape(*shape, 2)
    globals().update(ROOM_LO=ROOM_LO, ROOM_HI=ROOM_HI, XY_CANON=XY_CANON)
    if WALL_MARGIN_M and CAL_M: print(f"wall margin {WALL_MARGIN_M} m -> ignoring objects within {WALL_MARGIN_M / CAL_M:.3f} of the room edge (canonical)")
    globals().update(HEIGHT_VOX=HEIGHT_VOX)
    print(f"voxel {VOX:.4f} ref-units  min blob {MIN_VOXELS} vox  grid {shape} ({np.prod(shape)/1e6:.1f} M voxels)")
    occ, ijks, oks = zip(*[occupancy(c, lo, shape) for c in cs])
    st = ndimage.generate_binary_structure(3, 1)
    objects = []          # {id, present:[...], bbox}
    live = {}             # object id -> voxel mask on the dilated support (for tracking)
    labels = []           # per commit: uint16 grid, value = object id + 1, 0 = untracked/static
    for ci in range(N_COMMITS):
        if ci > 0:
            a, b = occ[ci-1], occ[ci]
            seen_a = ndimage.binary_dilation(a, st, iterations=COVERAGE)     # where capture a has geometry nearby at all
            seen_b = ndimage.binary_dilation(b, st, iterations=COVERAGE)
            added   = b & ~ndimage.binary_dilation(a, st, iterations=JITTER)
            removed = a & ~ndimage.binary_dilation(b, st, iterations=JITTER)
            labA, nA = components(added, seen_a); labR, nR = components(removed, seen_b)
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
        prev = ndimage.binary_dilation(occ[ci-1], st, iterations=1) if ci > 0 else np.zeros(shape, bool)
        for oid, g in live.items():
            reach = ndimage.binary_dilation(g, st, iterations=LABEL_DILATE) & ~(prev & ~g)
            lab[reach & (lab == 0)] = oid + 1
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
