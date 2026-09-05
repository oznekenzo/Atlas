"""
single: bring in one capture without the pipeline's registration and diff. A set with a single state has nothing to
register against and nothing to diff, so this puts the capture into the viewer's world frame on its own (y up, the
floor at y = 0, the walls square to the axes, the room centred on the origin), writes the SPZ, and labels the objects
the dataset draws by hand as boxes: the splats inside a box become that object's, so the viewer picks, brackets, dims
and lifts them like any tracked object. Publishes viewer/public/sets/<name>/ the way bake.publish does.

    python3 pipeline/single.py <set-name>

data/sets/<name>/dataset.json, beyond the keys dataset.py knows (calibration_m, commits, sites, standard, bake …):
  frame     {"up": "auto" | "+y" | "-y" | "+z" | "-z" | "+x" | "-x",   the raw axis that points up; auto = the axis
                                                                          with the sharpest density peak (the floor)
             "yaw_deg": "auto" | <degrees>,        the turn about the up axis that squares the walls to x and z
             "centre": "auto" | [x, z]}            the room's midpoint, moved to the origin
            every value the run resolves is logged; pin it here so the boxes below stay put run to run
  room      "auto" | [lo, hi] in world metres: the walls, floor and ceiling the camera stays inside
  view      optional {"pos": [x, y, z], "target": [x, y, z]}: where the camera stands when the set opens, in world metres
  voxel     label-grid cell in metres (default 0.05)
  objects   {"<id>": {"name", "doc", "by", "box": [[x, y, z], [x, y, z]]}}: ids 0…n-1, boxes in world metres.
            out/top.png is the floor from above on a 1 m grid with the boxes drawn, for placing them by eye.
Only commits[0] is used: a single state. The capture is expected to be metric (calibration_m = 1).
"""
import gzip
import hashlib
import json
import logging
import os
import struct
import sys
import zlib

import numpy as np

from bake import ply_to_spz, spz_path, spz_splats
from dataset import Dataset, PipelineError
from splat_io import read_ply, transform_raw, write_ply

log = logging.getLogger("single")

UP = {  # the raw axis that points up -> the proper rotation taking it onto +y
    "+y": np.eye(3),
    "-y": np.diag([1.0, -1.0, -1.0]),
    "+z": np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float),
    "-z": np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float),
    "+x": np.array([[0, 1, 0], [1, 0, 0], [0, 0, -1]], float),
    "-x": np.array([[0, -1, 0], [-1, 0, 0], [0, 0, -1]], float),
}
SOLID = 0.35            # opacity above which a splat counts as geometry
FLOOR_BIN_M = 0.01      # the floor is the densest band this thick
WALL_BIN_M = 0.03       # a wall squared to the axes stacks into a slab this thick
TALL_M = (1.25, 1.9)    # the band the walls, shelves and pegboard reach and nothing parked on the floor does
ROOM_PAD_M = 0.25
CEILING_MIN_M = 2.6     # room height when the scan stops short of the ceiling: the camera can still look down


# ---- the frame ----------------------------------------------------------------------------------------------------

def solid_cropped(d, crop=(2, 98), expand=0.2):
    """Solid splats inside the room: a real capture carries background splats far outside it."""
    p = d["xyz"][d["opacity"] > SOLID]
    lo, hi = np.percentile(p, crop[0], axis=0), np.percentile(p, crop[1], axis=0)
    pad = (hi - lo) * expand
    return p[np.all((p > lo - pad) & (p < hi + pad), axis=1)]


def find_up(p):
    """The vertical axis carries the floor, the sharpest density peak of the three; the floor sits at the peak's end."""
    best = None
    for ax in range(3):
        h, _ = np.histogram(p[:, ax], bins=80)
        k = int(h.argmax())
        frac = h[k] / len(p)
        if best is None or frac > best[0]:
            best = (frac, ax, k < 40)      # a peak in the lower half: the floor is at the low end, up is +axis
    frac, ax, low = best
    return ("+" if low else "-") + "xyz"[ax], float(frac)


def find_floor(y):
    """Where the floor is: the densest FLOOR_BIN_M band of the vertical range."""
    h, e = np.histogram(y, bins=max(1, int(np.ceil((y.max() - y.min()) / FLOOR_BIN_M))))
    k = int(h.argmax())
    return float((e[k] + e[k + 1]) / 2)


def rotation_to(a, b):
    """Rotation taking unit vector a onto unit vector b (Rodrigues)."""
    v = np.cross(a, b)
    s = np.linalg.norm(v)
    c = float(np.dot(a, b))
    if s < 1e-9:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K * ((1 - c) / s ** 2)


def level(p, floor_y, band=0.04):
    """The rotation that takes the fitted floor plane's normal onto +y: the raw up axis is rarely exactly vertical."""
    f = p[np.abs(p[:, 1] - floor_y) < band]
    A = np.c_[f[:, 0], f[:, 2], np.ones(len(f))]
    (a, b, _), *_ = np.linalg.lstsq(A, f[:, 1], rcond=None)
    n = np.array([-a, 1.0, -b])
    n /= np.linalg.norm(n)
    return rotation_to(n, np.array([0.0, 1.0, 0.0])), float(np.degrees(np.arccos(np.clip(n[1], -1, 1))))


def yaw(deg):
    """A turn about y: (x, z) -> (c x - s z, s x + c z)."""
    t = np.radians(deg)
    c, s = np.cos(t), np.sin(t)
    return np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])


def find_yaw(p, step=0.25):
    """The turn that squares the walls to the axes: the one stacking the tall splats into the thinnest slab across z."""
    tall = p[(p[:, 1] > TALL_M[0]) & (p[:, 1] < TALL_M[1])]
    if len(tall) < 500:
        tall = p[p[:, 1] > 0.3]
    best = (0, 0.0)
    for deg in np.arange(0.0, 90.0, step):
        r = tall[:, [0, 2]] @ yaw(deg)[np.ix_([0, 2], [0, 2])].T
        h, _ = np.histogram(r[:, 1], bins=max(1, int((r[:, 1].max() - r[:, 1].min()) / WALL_BIN_M)))
        if h.max() > best[0]:
            best = (int(h.max()), float(deg))
    return best[1]


def resolve_frame(d, spec):
    """raw -> world as a 4x4, and the values it was built from (so the dataset can pin them)."""
    p = solid_cropped(d)
    up = spec.get("up", "auto")
    if up == "auto":
        up, frac = find_up(p)
        log.info(f"up: {up} (the floor holds {frac * 100:.1f}% of the solid splats in one band)")
    elif up not in UP:
        raise PipelineError(f"frame.up must be one of {', '.join(UP)} or auto, got {up!r}")
    R1 = UP[up]
    p1 = p @ R1.T
    R2, tilt = level(p1, find_floor(p1[:, 1]))
    p2 = p1 @ R2.T
    floor = find_floor(p2[:, 1])
    p2[:, 1] -= floor
    log.info(f"floor: {floor:.3f} raw units below the levelled origin; the floor plane was {tilt:.2f}° off level")
    yaw_deg = spec.get("yaw_deg", "auto")
    if yaw_deg == "auto":
        yaw_deg = find_yaw(p2)
        log.info(f"yaw: {yaw_deg:.2f}° squares the walls to the axes")
    R3 = yaw(float(yaw_deg))
    p3 = p2 @ R3.T
    centre = spec.get("centre", "auto")
    if centre == "auto":
        lo, hi = np.percentile(p3[:, [0, 2]], 2, axis=0), np.percentile(p3[:, [0, 2]], 98, axis=0)
        centre = ((lo + hi) / 2).round(3).tolist()
        log.info(f"centre: the room's midpoint was at x = {centre[0]:.3f}, z = {centre[1]:.3f}; now the origin")
    T = np.eye(4)
    T[:3, :3] = R3 @ R2 @ R1
    T[:3, 3] = [-float(centre[0]), -floor, -float(centre[1])]     # the yaw leaves the floor shift alone: it is along y
    return T, {"up": up, "yaw_deg": float(yaw_deg), "centre": [float(centre[0]), float(centre[1])],
               "floor_raw": floor, "tilt_deg": tilt}


def auto_room(w):
    """Walls a little outside the solid splats; the floor at 0; a ceiling the camera can look down from."""
    lo, hi = np.percentile(w, 1, axis=0), np.percentile(w, 99, axis=0)
    top = float(np.percentile(w[:, 1], 99.5))
    return [[round(float(lo[0]) - ROOM_PAD_M, 2), 0.0, round(float(lo[2]) - ROOM_PAD_M, 2)],
            [round(float(hi[0]) + ROOM_PAD_M, 2), round(max(CEILING_MIN_M, top + 0.5), 2), round(float(hi[2]) + ROOM_PAD_M, 2)]]


# ---- the objects --------------------------------------------------------------------------------------------------

def read_objects(spec, ds):
    raw = spec.get("objects") or {}
    out = []
    for i in range(len(raw)):
        o = raw.get(str(i))
        if o is None:
            raise PipelineError(f"{ds.json_path}: objects must be numbered 0…{len(raw) - 1}; {i} is missing")
        box = o.get("box")
        if not (isinstance(box, list) and len(box) == 2 and all(isinstance(c, list) and len(c) == 3 for c in box)):
            raise PipelineError(f"{ds.json_path}: objects[{i}].box must be [[x, y, z], [x, y, z]]")
        lo, hi = np.array(box[0], float), np.array(box[1], float)
        if np.any(hi <= lo):
            raise PipelineError(f"{ds.json_path}: objects[{i}].box must have lo < hi on every axis")
        meta = ds.object_names.get(i, {})
        out.append({"id": i, "name": meta.get("name", f"Object {i:02d}"), "lo": lo, "hi": hi,
                    **{k: meta[k] for k in ("doc", "by") if k in meta}})
    return out


def label_grid(room, voxel, objects, w):
    """A voxel grid over the room, C-order (i, j, k) like diff.py's, holding object id + 1 inside each box, 0 elsewhere.
    Returns the grid and, per object, how many of its voxels actually hold a solid splat."""
    lo, hi = np.array(room[0], float), np.array(room[1], float)
    shape = np.ceil((hi - lo) / voxel).astype(int)
    grid = np.zeros(shape, np.uint16)
    for o in objects:
        i0 = np.clip(np.floor((o["lo"] - lo) / voxel).astype(int), 0, shape)
        i1 = np.clip(np.ceil((o["hi"] - lo) / voxel).astype(int), 0, shape)
        grid[i0[0]:i1[0], i0[1]:i1[1], i0[2]:i1[2]] = o["id"] + 1
    idx = np.floor((w - lo) / voxel).astype(int)
    inside = np.all((idx >= 0) & (idx < shape), axis=1)
    flat = np.ravel_multi_index(idx[inside].T, shape)
    occupied = np.zeros(grid.size, bool)
    occupied[np.unique(flat)] = True
    counts = np.bincount(grid.ravel()[occupied], minlength=len(objects) + 1)
    return grid, shape, [int(counts[o["id"] + 1]) for o in objects]


# ---- the picture --------------------------------------------------------------------------------------------------

def write_png(path, rgb):
    h, wd, _ = rgb.shape
    body = b"".join(b"\x00" + rgb[y].tobytes() for y in range(h))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", wd, h, 8, 2, 0, 0, 0))
                 + chunk(b"IDAT", zlib.compress(body, 6)) + chunk(b"IEND", b""))


def top_view(path, w, room, objects, ppm=120):
    """The floor from above: solid splats above ankle height, a 1 m grid (x = 0 and z = 0 bright), the boxes outlined."""
    lo, hi = np.array(room[0]), np.array(room[1])
    W, H = int((hi[0] - lo[0]) * ppm), int((hi[2] - lo[2]) * ppm)
    h = w[(w[:, 1] > 0.12) & (w[:, 1] < hi[1])]
    u = ((h[:, 0] - lo[0]) * ppm).astype(int)
    v = ((h[:, 2] - lo[2]) * ppm).astype(int)
    ok = (u >= 0) & (u < W) & (v >= 0) & (v < H)
    cnt = np.zeros((H, W))
    np.add.at(cnt, (H - 1 - v[ok], u[ok]), 1)
    g = np.log1p(cnt) / np.log1p(max(cnt.max(), 1)) * 255
    img = np.stack([g, g, g], -1)
    px = lambda x: int((x - lo[0]) * ppm)
    py = lambda z: H - 1 - int((z - lo[2]) * ppm)
    for x in np.arange(np.ceil(lo[0]), hi[0], 1.0):
        if 0 <= px(x) < W:
            img[:, px(x)] = [200, 60, 60] if abs(x) < 1e-6 else [90, 40, 40]
    for z in np.arange(np.ceil(lo[2]), hi[2], 1.0):
        if 0 <= py(z) < H:
            img[py(z), :] = [60, 200, 60] if abs(z) < 1e-6 else [40, 90, 40]
    for o in objects:
        x0, x1 = sorted((max(0, px(o["lo"][0])), min(W - 1, px(o["hi"][0]))))
        y0, y1 = sorted((max(0, py(o["hi"][2])), min(H - 1, py(o["lo"][2]))))
        img[y0, x0:x1 + 1] = img[y1, x0:x1 + 1] = [255, 200, 60]
        img[y0:y1 + 1, x0] = img[y0:y1 + 1, x1] = [255, 200, 60]
    write_png(path, np.clip(img, 0, 255).astype(np.uint8))


# ---- the run ------------------------------------------------------------------------------------------------------

def run(ds):
    with open(ds.json_path) as fh:
        spec = json.load(fh)
    c = ds.commits[0]
    if len(ds.commits) > 1:
        log.warning(f"{len(ds.commits)} commits listed; a single set has one state, so only c0 is used")
    if ds.bake.sh != 0:
        raise PipelineError("single sets are written at SH degree 0 (bake.sh)")
    os.makedirs(ds.out_dir, exist_ok=True)
    os.makedirs(os.path.join(ds.pub_dir, "commits"), exist_ok=True)

    d = read_ply(c.file)
    T, resolved = resolve_frame(d, spec.get("frame") or {})
    keep = d["opacity"] >= ds.bake.prune_opacity if ds.bake.prune_opacity > 0 else np.ones(len(d["opacity"]), bool)
    raw = transform_raw(np.asarray(d["raw"][keep]), d["names"], T)
    col = {name: i for i, name in enumerate(d["names"])}
    w = raw[:, [col["x"], col["y"], col["z"]]].astype(np.float64)
    solid = w[np.asarray(d["opacity"][keep]) > SOLID]

    room = spec.get("room", "auto")
    if room == "auto":
        room = auto_room(solid)
        log.info(f"room: {room[0]} .. {room[1]} (pin it in dataset.json as \"room\")")
    elif not (isinstance(room, list) and len(room) == 2 and all(isinstance(r, list) and len(r) == 3 for r in room)):
        raise PipelineError(f"{ds.json_path}: room must be auto or [[x, y, z], [x, y, z]]")
    voxel = float(spec.get("voxel", 0.05))
    if voxel <= 0:
        raise PipelineError(f"{ds.json_path}: voxel must be positive")
    view = spec.get("view")
    if view is not None and not (isinstance(view, dict) and all(isinstance(view.get(k), list) and len(view[k]) == 3 for k in ("pos", "target"))):
        raise PipelineError(f"{ds.json_path}: view must be {{\"pos\": [x, y, z], \"target\": [x, y, z]}}")
    objects = read_objects(spec, ds)
    grid, shape, occupied = label_grid(room, voxel, objects, solid)
    top_view(os.path.join(ds.out_dir, "top.png"), solid, room, objects)
    with open(os.path.join(ds.out_dir, "frame.json"), "w") as fh:
        json.dump({"world_from_raw": T.tolist(), **resolved, "room": room}, fh, indent=1)

    aligned = ds.aligned_ply(0)
    write_ply(aligned, raw, d["names"])
    spz = spz_path(ds, 0)
    ply_to_spz(aligned, spz, 0)
    with open(spz, "rb") as fh:
        digest = hashlib.sha1(fh.read()).hexdigest()[:7]
    labels = os.path.join(ds.pub_dir, "commits", "c0.labels.bin")
    with gzip.open(ds.labels_path(0), "wb", compresslevel=6) as fh:
        fh.write(np.ascontiguousarray(grid).tobytes())
    with open(ds.labels_path(0), "rb") as src, open(labels, "wb") as dst:
        dst.write(src.read())
    log.info(f"c0  {len(d['raw']):>9,} -> {len(raw):>9,} splats (pruned <{ds.bake.prune_opacity})   "
             f"spz {os.path.getsize(spz) / 1e6:5.1f} MB   {digest}")

    published = []
    for o, n in zip(objects, occupied):
        published.append({"id": o["id"], "source_id": o["id"], "name": o["name"],
                          **{k: o[k] for k in ("doc", "by") if k in o},
                          "added_in": 0, "removed_in": None, "present": [0], "voxels": n,
                          "volume_vox_m3": round(n * voxel ** 3, 4), "moved_from": None, "moved_to": None,
                          "bbox": [o["lo"].round(4).tolist(), o["hi"].round(4).tolist()]})
        log.info(f"  #{o['id']} {o['name']}: {n} occupied voxels in its box")
    manifest = {"commits": [{"id": "c0", "index": 0, "hash": digest, "message": c.message, "captured": c.captured,
                             "file": "commits/c0.spz", "splats": spz_splats(spz), "labels": "commits/c0.labels.bin",
                             "doc": c.doc, "by": c.by, **({"stats": c.stats} if c.stats else {})}],
                "voxel": voxel, "origin": [float(v) for v in room[0]], "shape": [int(s) for s in shape], "room": room,
                **({"view": view} if view else {}),
                "world_from_ref": np.eye(4).tolist(),       # the grid and the boxes are in world metres already
                "calibration_m": ds.calibration_m,
                **({"standard": ds.standard} if ds.standard is not None else {}),
                **({"sites": ds.sites} if ds.sites else {}),
                "objects": published}
    path = os.path.join(ds.pub_dir, "commits.json")
    with open(path, "w") as fh:
        json.dump(manifest, fh, indent=1)
    log.info(f"wrote {path}  ({len(published)} objects; the floor from above is at {os.path.join(ds.out_dir, 'top.png')})")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if len(sys.argv) != 2:
        sys.exit("usage: python3 single.py <set-name>")
    try:
        run(Dataset(sys.argv[1]))
    except PipelineError as e:
        sys.exit(f"single: {e}")
