"""
Synthetic 6-commit garage, written as a complete dataset at data/sets/synthetic/:
  raw/c<i>.ply    REAL 3DGS .ply (SH degree 3, 62 floats/splat, binary little-endian) — the exact layout
                  Teleport's "uncompressed .ply" export uses
  dataset.json    what run.py needs (commits, calibration, tuning)
  truth.json      ground truth: per-commit frames + scales, object membership and centres, for scoring

Each capture gets:
  - the same static shell (floor, walls, ceiling, joists, garage door, side door)
  - its commit's objects
  - independent reconstruction noise + floaters
  - its own arbitrary rigid frame AND its own arbitrary scale (Teleport is not metric)

usage: python3 pipeline/make_synthetic.py          then    python3 pipeline/run.py synthetic
"""
import json
import os

import numpy as np
from scipy.spatial import cKDTree

from dataset import ROOT

RNG = np.random.default_rng(7)
SH_C0 = 0.28209479177387814
SET_DIR = os.path.join(ROOT, "data", "sets", "synthetic")
RAW_DIR = os.path.join(SET_DIR, "raw")
W, D, H = 6.0, 6.5, 2.7          # garage, metres, origin at floor centre
CALIBRATION_M = D                # the longest wall-to-wall span


def box_surface(center, size, n, faces="all", rng=RNG):
    cx, cy, cz = center
    sx, sy, sz = size
    areas = {"+x": sy * sz, "-x": sy * sz, "+y": sx * sz, "-y": sx * sz, "+z": sx * sy, "-z": sx * sy}
    if faces != "all":
        areas = {k: v for k, v in areas.items() if k in faces}
    keys = list(areas)
    w = np.array([areas[k] for k in keys], float)
    w /= w.sum()
    pick = rng.choice(len(keys), size=n, p=w)
    u = rng.random(n) - .5
    v = rng.random(n) - .5
    p = np.zeros((n, 3))
    for i, k in enumerate(keys):
        m = pick == i
        sign = 1 if k[0] == "+" else -1
        if k[1] == "x":
            p[m] = np.c_[np.full(m.sum(), cx + sign * sx / 2), cy + u[m] * sy, cz + v[m] * sz]
        elif k[1] == "y":
            p[m] = np.c_[cx + u[m] * sx, np.full(m.sum(), cy + sign * sy / 2), cz + v[m] * sz]
        else:
            p[m] = np.c_[cx + u[m] * sx, cy + v[m] * sy, np.full(m.sum(), cz + sign * sz / 2)]
    return p


def cyl_surface(center, r, h, n, axis=2, rng=RNG):
    cx, cy, cz = center
    th = rng.random(n) * 2 * np.pi
    hh = (rng.random(n) - .5) * h
    if axis == 0:
        return np.c_[cx + hh, cy + r * np.cos(th), cz + r * np.sin(th)]
    if axis == 1:
        return np.c_[cx + r * np.cos(th), cy + hh, cz + r * np.sin(th)]
    return np.c_[cx + r * np.cos(th), cy + r * np.sin(th), cz + hh]


def colored(p, rgb, jitter=.03):
    return p, np.clip(np.tile(rgb, (len(p), 1)) + RNG.normal(0, jitter, (len(p), 3)), 0, 1)


def stack(parts):
    return np.vstack([x[0] for x in parts]), np.vstack([x[1] for x in parts])


def shell(density=2200):
    parts = []
    n = int(W * D * density)
    p = box_surface((0, 0, 0), (W, D, .02), n, faces=("+z",))
    c = np.tile([.38, .37, .36], (n, 1)) + RNG.normal(0, .035, (n, 3))
    c *= 1 - .35 * np.exp(-((p[:, 0] - 1.1) ** 2 + (p[:, 1] + .8) ** 2) / .6)[:, None]        # oil stain
    parts.append((p, np.clip(c, 0, 1)))
    parts.append(colored(box_surface((0, 0, H), (W, D, .02), int(W * D * density * .5), faces=("-z",)), [.55, .54, .52]))
    for jy in np.arange(-D / 2 + .6, D / 2, 1.2):
        parts.append(colored(box_surface((0, jy, H - .12), (W, .09, .22), 2600), [.46, .40, .32]))
    for ctr, size in [((-W / 2, 0, H / 2), (.02, D, H)), ((W / 2, 0, H / 2), (.02, D, H)), ((0, D / 2, H / 2), (W, .02, H))]:
        parts.append(colored(box_surface(ctr, size, int(max(size) * H * density * .8)), [.72, .71, .68], .028))
    for k, pz in enumerate(np.arange(.28, H, .55)):                                # door ribs
        p, c = colored(box_surface((0, -D / 2 + .06, pz), (W - .2, .07, .48), 6000), [.80, .79, .76], .022)
        parts.append((p, c * (1 - .12 * (k % 2))))
    parts.append(colored(box_surface((W / 2 - .02, D / 2 - 1.1, 1.05), (.06, .92, 2.1), 3400), [.30, .29, .28]))
    parts += fixtures(density)
    return stack(parts)


def fixtures(density):
    """Fixed installations that make the room asymmetric, as every real room is: without them a near-square
    box is ambiguous under 90/180-degree yaw (with scale free) to within a few percent of its points."""
    def surface(centre, size, faces, rgb, jitter):
        sx, sy, sz = size
        area = {"x": sy * sz, "y": sx * sz, "z": sx * sy}
        n = int(sum(area[f[1]] for f in faces) * density)
        return colored(box_surface(centre, size, n, faces=faces), rgb, jitter)

    counter = ((W / 2 - .30, -1.2, .45), (.60, 2.4, .90))                        # fixed counter along the +x wall
    cabinets = [((W / 2 - .18, cy, 1.75), (.36, .80, .70)) for cy in (-1.7, -0.7)]  # wall cabinets above it
    closet = ((-W / 2 + .45, D / 2 - .45, H / 2), (.90, .90, H))                  # boxed-in utility closet, -x/+y corner
    step = ((W / 2 - .50, D / 2 - 1.1, .10), (1.0, 1.2, .20))                     # step up to the side door
    panel = ((-W / 2 + .05, -2.6, 1.5), (.10, .40, .70))                          # electrical panel on the -x wall
    parts = [surface(*counter, ("+z", "-x", "+y", "-y"), [.58, .56, .50], .03),
             surface(*closet, ("+x", "-y"), [.72, .71, .68], .028),
             surface(*step, ("+z", "-x", "+y", "-y"), [.45, .44, .42], .03),
             surface(*panel, ("+x", "+y", "-y", "+z", "-z"), [.70, .70, .72], .02)]
    parts += [surface(*cab, ("-x", "+y", "-y", "+z", "-z"), [.62, .58, .50], .03) for cab in cabinets]
    heater_r, heater_h = .28, 1.5                                                  # water heater in the +x/-y corner
    heater_c = (W / 2 - .40, -D / 2 + .40, heater_h / 2)
    parts.append(colored(cyl_surface(heater_c, heater_r, heater_h, int(2 * np.pi * heater_r * heater_h * density)),
                         [.80, .80, .78], .02))
    return parts


# Every object generator returns a list of (points, colours) parts; truth.json records one centre per part,
# because a detected blob may be one part (a single box of the pile) or several parts fused (bins on a shelf).
def obj_boxpile():
    r = np.random.default_rng(11)
    out = []
    for _ in range(7):
        c = (r.uniform(-2.4, -.6), r.uniform(-2.2, 1.8), r.uniform(.15, .95))
        s = (r.uniform(.35, .6), r.uniform(.3, .55), r.uniform(.28, .45))
        out.append(colored(box_surface(c, s, 11000, rng=r), [.62, .48, .33], .04))
    return out


def obj_bike():
    return [colored(cyl_surface((1.9, 1.5, .34), .34, .04, 4600, axis=1), [.10, .10, .11]),
            colored(cyl_surface((1.9, .45, .34), .34, .04, 4600, axis=1), [.10, .10, .11]),
            colored(box_surface((1.9, .98, .72), (.05, 1.0, .42), 3200), [.55, .12, .12])]


def obj_shelving():
    parts = [colored(box_surface((0, D / 2 - .30, z), (2.4, .48, .04), 7500), [.50, .51, .54]) for z in (.30, .95, 1.60, 2.05)]
    parts += [colored(box_surface((ux, uy, 1.05), (.05, .05, 2.1), 2200), [.44, .45, .47])
              for ux in (-1.18, 1.18) for uy in (D / 2 - .50, D / 2 - .10)]
    return parts


def obj_bins():
    cols = [[.18, .35, .62], [.18, .35, .62], [.65, .55, .18], [.18, .35, .62]]
    return [colored(box_surface((x, D / 2 - .30, z + .13), (.42, .34, .26), 3400), col, .035)
            for x, col in zip([-.85, -.30, .35, .95], cols) for z in (1.00, 1.65)]


def obj_bench():
    parts = [colored(box_surface((-1.5, .2, .88), (.70, 2.0, .06), 9500), [.52, .40, .26], .035)]
    parts += [colored(box_surface((lx, ly, .44), (.07, .07, .88), 2000), [.38, .31, .22])
              for lx, ly in [(-1.78, -.68), (-1.22, -.68), (-1.78, 1.08), (-1.22, 1.08)]]
    return parts


def obj_project():
    """Its own generator so the scattered offcuts land in the same place in every commit."""
    r = np.random.default_rng(13)
    parts = [colored(box_surface((-1.5, .35, 1.00), (.42, .78, .18), 4200, rng=r), [.66, .52, .34], .04),
             colored(box_surface((-1.5, -.15, .97), (.10, .10, .30), 1600, rng=r), [.25, .26, .28])]
    for _ in range(5):
        centre = (r.uniform(-2.1, -.9), r.uniform(-.8, 1.4), .03)
        size = (r.uniform(.1, .4), r.uniform(.1, .5), .04)
        parts.append(colored(box_surface(centre, size, 1000, rng=r), [.60, .47, .30], .05))
    return parts


def obj_car():
    parts = [colored(box_surface((.95, -.35, .74), (1.82, 4.35, .95), 46000), [.13, .14, .16], .045),
             colored(box_surface((.95, -.35, 1.34), (1.62, 2.25, .58), 18000), [.19, .21, .24], .07)]
    parts += [colored(cyl_surface((wx, wy, .32), .32, .20, 3800, axis=0), [.09, .09, .10])
              for wx, wy in [(.20, 1.30), (1.70, 1.30), (.20, -1.85), (1.70, -1.85)]]
    return parts


OBJECTS = [("Boxes, stacked", obj_boxpile, [0, 1]),        # c1 = "cleared to one side": boxes MOVE, not vanish
           ("Bicycle", obj_bike, [0, 1]),
           ("Steel shelving", obj_shelving, [2, 3, 4, 5]),
           ("Storage bins", obj_bins, [3, 4, 5]),
           ("Workbench", obj_bench, [2, 3, 4, 5]),
           ("Work in progress", obj_project, [4, 5]),
           ("Car", obj_car, [5])]
# in c1 the boxes and bike are shoved against the left wall (a real clear-out, and it keeps texture)
MOVED_IN_C1 = {"Boxes, stacked": np.array([-0.3, 0.9, 0.]), "Bicycle": np.array([-3.6, 1.2, 0.])}

COMMITS = [("As found.", "2026-09-02T18:12:00-07:00"),
           ("Cleared to one side.", "2026-09-02T19:40:00-07:00"),
           ("Shelving and bench in.", "2026-09-02T21:05:00-07:00"),
           ("Tooled up. Bins on the racks.", "2026-09-02T22:18:00-07:00"),
           ("First job on the bench.", "2026-09-03T00:02:00-07:00"),
           ("Car in.", "2026-09-03T00:51:00-07:00")]


def rigid_and_scale(seed):
    r = np.random.default_rng(seed)
    yaw = r.uniform(-np.pi, np.pi)
    tx, ty = r.normal(0, .02, 2)
    cy, sy = np.cos(yaw), np.sin(yaw)
    Rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    Rx = np.array([[1, 0, 0], [0, np.cos(tx), -np.sin(tx)], [0, np.sin(tx), np.cos(tx)]])
    Ry = np.array([[np.cos(ty), 0, np.sin(ty)], [0, 1, 0], [-np.sin(ty), 0, np.cos(ty)]])
    return Rz @ Rx @ Ry, np.r_[r.uniform(-3, 3, 2), r.uniform(-.4, .4)], float(r.uniform(.6, 1.7))


def write_ply(path, xyz, rgb, scales, opacity):
    n = len(xyz)
    props = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2"] + [f"f_rest_{i}" for i in range(45)] \
        + ["opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
    header = ("ply\nformat binary_little_endian 1.0\n"
              f"element vertex {n}\n"
              + "".join(f"property float {p}\n" for p in props)
              + "end_header\n").encode()
    f_dc = (rgb - .5) / SH_C0
    f_rest = RNG.normal(0, .02, (n, 45))                                 # weak view dependence
    arr = np.hstack([xyz, np.zeros((n, 3)), f_dc, f_rest,
                     np.log(opacity / (1 - opacity))[:, None], np.log(scales),
                     np.tile([1., 0., 0., 0.], (n, 1))]).astype(np.float32)
    assert arr.shape[1] == 62
    with open(path, "wb") as fh:
        fh.write(header)
        arr.tofile(fh)
    return n


def make_commit(ci, msg, ts, truth_objects):
    pts, cols = shell()
    present = []
    for name, gen, commits in OBJECTS:
        if ci not in commits:
            continue
        parts = gen()
        p, c = stack(parts)
        shift = MOVED_IN_C1[name] if ci == 1 and name in MOVED_IN_C1 else np.zeros(3)
        p = p + shift
        truth_objects[name]["centres"][str(ci)] = p.mean(0).round(4).tolist()
        truth_objects[name]["parts"][str(ci)] = [{"centre": (q + shift).mean(0).round(4).tolist(), "points": len(q),
                                                  "top": round(float(q[:, 2].max() + shift[2]), 4)} for q, _ in parts]
        pts = np.vstack([pts, p])
        cols = np.vstack([cols, c])
        present.append(name)
    pts += RNG.normal(0, .006, pts.shape)
    cols = np.clip(cols + RNG.normal(0, .012, cols.shape), 0, 1)
    nf = 1600                                                            # floaters
    pts = np.vstack([pts, np.c_[RNG.uniform(-W / 2, W / 2, nf), RNG.uniform(-D / 2, D / 2, nf), RNG.uniform(.2, H, nf)]])
    cols = np.vstack([cols, RNG.uniform(.2, .7, (nf, 3))])
    op = np.r_[np.full(len(pts) - nf, .92), np.full(nf, .15)]
    # realistic splat size: each gaussian covers its neighbours (~0.75 x local spacing), floaters bigger & faint
    nn, _ = cKDTree(pts[:-nf]).query(pts[:-nf], k=4, workers=-1)
    spacing = nn[:, 1:].mean(1)
    sc = np.full((len(pts), 3), .02)
    sc[:-nf] = (0.75 * spacing)[:, None] * (1 + RNG.normal(0, .2, (len(pts) - nf, 1)))
    sc[-nf:] = RNG.uniform(.02, .08, (nf, 1))
    sc = np.clip(sc, .004, .12)
    R, t, s = rigid_and_scale(100 + ci)                                  # Teleport-style: own frame, own scale
    path = os.path.join(RAW_DIR, f"c{ci}.ply")
    n = write_ply(path, s * (pts @ R.T) + t, cols, sc * s, op)
    print(f"c{ci}  {n:>8,} splats  {os.path.getsize(path) / 1e6:6.1f} MB  scale {s:.2f}  {msg}")
    return {"index": ci, "message": msg, "captured": ts, "file": f"raw/c{ci}.ply", "splats": n, "objects": present,
            "frame": {"R": R.tolist(), "t": t.tolist(), "scale": s}}


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    truth_objects = {name: {"name": name, "commits": commits, "centres": {}, "parts": {}} for name, _, commits in OBJECTS}
    truth = {"commits": [], "objects": list(truth_objects.values()), "room_m": [W, D, H]}
    for ci, (msg, ts) in enumerate(COMMITS):
        truth["commits"].append(make_commit(ci, msg, ts, truth_objects))
    with open(os.path.join(SET_DIR, "truth.json"), "w") as fh:
        json.dump(truth, fh, indent=1)
    dataset = {
        "calibration_m": CALIBRATION_M,
        "calibration_note": "synthetic: the long wall-to-wall span is exactly this",
        "commits": [{"file": c["file"], "message": c["message"], "captured": c["captured"]} for c in truth["commits"]],
        "diff": {"wall_margin_m": 0.0},
        "bake": {"prune_opacity": 0.0, "sh": 1},
    }
    with open(os.path.join(SET_DIR, "dataset.json"), "w") as fh:
        json.dump(dataset, fh, indent=1)
    print(f"wrote {SET_DIR}/{{dataset.json, truth.json}}")


if __name__ == "__main__":
    main()
