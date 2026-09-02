"""
Synthetic 6-commit garage, written as REAL 3DGS .ply (SH degree 3, 62 floats/splat,
binary little-endian) — the exact layout Teleport's "uncompressed .ply" export uses.

Each capture gets:
  - the same static shell (floor, walls, ceiling, joists, garage door, side door)
  - its commit's objects
  - independent reconstruction noise + floaters
  - its own arbitrary rigid frame AND its own arbitrary scale (Teleport is not metric)
Ground truth (frames, scales, object membership) goes to truth.json so the pipeline
can be scored, not just eyeballed.
"""
import numpy as np, json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RNG = np.random.default_rng(7)
SH_C0 = 0.28209479177387814
OUT = os.path.join(ROOT, "data", "raw"); os.makedirs(OUT, exist_ok=True)
W, D, H = 6.0, 6.5, 2.7          # garage, metres, origin at floor centre

def box_surface(center, size, n, faces="all", rng=RNG):
    cx, cy, cz = center; sx, sy, sz = size
    areas = {"+x": sy*sz, "-x": sy*sz, "+y": sx*sz, "-y": sx*sz, "+z": sx*sy, "-z": sx*sy}
    if faces != "all": areas = {k: v for k, v in areas.items() if k in faces}
    keys = list(areas); w = np.array([areas[k] for k in keys], float); w /= w.sum()
    pick = rng.choice(len(keys), size=n, p=w); u, v = rng.random(n)-.5, rng.random(n)-.5
    p = np.zeros((n, 3))
    for i, k in enumerate(keys):
        m = pick == i
        if k[1] == "x": p[m] = np.c_[np.full(m.sum(), cx + (sx/2 if k[0]=="+" else -sx/2)), cy+u[m]*sy, cz+v[m]*sz]
        elif k[1] == "y": p[m] = np.c_[cx+u[m]*sx, np.full(m.sum(), cy + (sy/2 if k[0]=="+" else -sy/2)), cz+v[m]*sz]
        else: p[m] = np.c_[cx+u[m]*sx, cy+v[m]*sy, np.full(m.sum(), cz + (sz/2 if k[0]=="+" else -sz/2))]
    return p

def cyl_surface(center, r, h, n, axis=2):
    cx, cy, cz = center; th = RNG.random(n)*2*np.pi; hh = (RNG.random(n)-.5)*h
    if axis == 0: return np.c_[cx+hh, cy+r*np.cos(th), cz+r*np.sin(th)]
    if axis == 1: return np.c_[cx+r*np.cos(th), cy+hh, cz+r*np.sin(th)]
    return np.c_[cx+r*np.cos(th), cy+r*np.sin(th), cz+hh]

def colored(p, rgb, jitter=.03):
    return p, np.clip(np.tile(rgb, (len(p), 1)) + RNG.normal(0, jitter, (len(p), 3)), 0, 1)

def shell(density=2200):
    parts = []
    n = int(W*D*density); p = box_surface((0,0,0), (W,D,.02), n, faces=("+z",))
    c = np.tile([.38,.37,.36], (n,1)) + RNG.normal(0,.035,(n,3))
    c *= 1 - .35*np.exp(-((p[:,0]-1.1)**2 + (p[:,1]+.8)**2)/.6)[:,None]        # oil stain
    parts.append((p, np.clip(c,0,1)))
    parts.append(colored(box_surface((0,0,H), (W,D,.02), int(W*D*density*.5), faces=("-z",)), [.55,.54,.52]))
    for jy in np.arange(-D/2+.6, D/2, 1.2):
        parts.append(colored(box_surface((0,jy,H-.12), (W,.09,.22), 2600), [.46,.40,.32]))
    for ctr, size in [((-W/2,0,H/2),(.02,D,H)), ((W/2,0,H/2),(.02,D,H)), ((0,D/2,H/2),(W,.02,H))]:
        parts.append(colored(box_surface(ctr, size, int(max(size)*H*density*.8)), [.72,.71,.68], .028))
    for k, pz in enumerate(np.arange(.28, H, .55)):                                # door ribs
        p, c = colored(box_surface((0,-D/2+.06,pz), (W-.2,.07,.48), 6000), [.80,.79,.76], .022)
        parts.append((p, c*(1-.12*(k%2))))
    parts.append(colored(box_surface((W/2-.02, D/2-1.1, 1.05), (.06,.92,2.1), 3400), [.30,.29,.28]))
    return np.vstack([x[0] for x in parts]), np.vstack([x[1] for x in parts])

def obj_boxpile():
    r = np.random.default_rng(11); out = []
    for _ in range(7):
        c = (r.uniform(-2.4,-.6), r.uniform(-2.2,1.8), r.uniform(.15,.95))
        s = (r.uniform(.35,.6), r.uniform(.3,.55), r.uniform(.28,.45))
        out.append(colored(box_surface(c, s, 11000, rng=r), [.62,.48,.33], .04))
    return np.vstack([o[0] for o in out]), np.vstack([o[1] for o in out])
def obj_bike():
    parts = [colored(cyl_surface((1.9,1.5,.34),.34,.04,4600,axis=1), [.10,.10,.11]),
             colored(cyl_surface((1.9,.45,.34),.34,.04,4600,axis=1), [.10,.10,.11]),
             colored(box_surface((1.9,.98,.72),(.05,1.0,.42),3200), [.55,.12,.12])]
    return np.vstack([x[0] for x in parts]), np.vstack([x[1] for x in parts])
def obj_shelving():
    parts = [colored(box_surface((0,D/2-.30,z),(2.4,.48,.04),7500), [.50,.51,.54]) for z in (.30,.95,1.60,2.05)]
    parts += [colored(box_surface((ux,uy,1.05),(.05,.05,2.1),2200), [.44,.45,.47]) for ux in (-1.18,1.18) for uy in (D/2-.50, D/2-.10)]
    return np.vstack([x[0] for x in parts]), np.vstack([x[1] for x in parts])
def obj_bins():
    cols = [[.18,.35,.62],[.18,.35,.62],[.65,.55,.18],[.18,.35,.62]]
    parts = [colored(box_surface((x,D/2-.30,z+.13),(.42,.34,.26),3400), col, .035)
             for x, col in zip([-.85,-.30,.35,.95], cols) for z in (1.00,1.65)]
    return np.vstack([x[0] for x in parts]), np.vstack([x[1] for x in parts])
def obj_bench():
    parts = [colored(box_surface((-1.5,.2,.88),(.70,2.0,.06),9500), [.52,.40,.26], .035)]
    parts += [colored(box_surface((lx,ly,.44),(.07,.07,.88),2000), [.38,.31,.22]) for lx,ly in [(-1.78,-.68),(-1.22,-.68),(-1.78,1.08),(-1.22,1.08)]]
    return np.vstack([x[0] for x in parts]), np.vstack([x[1] for x in parts])
def obj_project():
    parts = [colored(box_surface((-1.5,.35,1.00),(.42,.78,.18),4200), [.66,.52,.34], .04),
             colored(box_surface((-1.5,-.15,.97),(.10,.10,.30),1600), [.25,.26,.28])]
    parts += [colored(box_surface((RNG.uniform(-2.1,-.9),RNG.uniform(-.8,1.4),.03),(RNG.uniform(.1,.4),RNG.uniform(.1,.5),.04),1000), [.60,.47,.30], .05) for _ in range(5)]
    return np.vstack([x[0] for x in parts]), np.vstack([x[1] for x in parts])
def obj_car():
    parts = [colored(box_surface((.95,-.35,.74),(1.82,4.35,.95),46000), [.13,.14,.16], .045),
             colored(box_surface((.95,-.35,1.34),(1.62,2.25,.58),18000), [.19,.21,.24], .07)]
    parts += [colored(cyl_surface((wx,wy,.32),.32,.20,3800,axis=0), [.09,.09,.10]) for wx,wy in [(.20,1.30),(1.70,1.30),(.20,-1.85),(1.70,-1.85)]]
    return np.vstack([x[0] for x in parts]), np.vstack([x[1] for x in parts])

OBJECTS = [("Boxes, stacked", obj_boxpile, [0,1]),        # c1 = "cleared to one side": boxes MOVE, not vanish
           ("Bicycle", obj_bike, [0,1]),
           ("Steel shelving", obj_shelving, [2,3,4,5]),
           ("Storage bins", obj_bins, [3,4,5]),
           ("Workbench", obj_bench, [2,3,4,5]),
           ("Work in progress", obj_project, [4,5]),
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
    yaw = r.uniform(-np.pi, np.pi); tx, ty = r.normal(0, .02, 2)
    cy, sy = np.cos(yaw), np.sin(yaw); Rz = np.array([[cy,-sy,0],[sy,cy,0],[0,0,1]])
    Rx = np.array([[1,0,0],[0,np.cos(tx),-np.sin(tx)],[0,np.sin(tx),np.cos(tx)]])
    Ry = np.array([[np.cos(ty),0,np.sin(ty)],[0,1,0],[-np.sin(ty),0,np.cos(ty)]])
    return Rz@Rx@Ry, np.r_[r.uniform(-3,3,2), r.uniform(-.4,.4)], float(r.uniform(.6, 1.7))

def write_ply(path, xyz, rgb, scales, opacity):
    n = len(xyz)
    props = ["x","y","z","nx","ny","nz","f_dc_0","f_dc_1","f_dc_2"] + [f"f_rest_{i}" for i in range(45)] \
          + ["opacity","scale_0","scale_1","scale_2","rot_0","rot_1","rot_2","rot_3"]
    hdr = ("ply\nformat binary_little_endian 1.0\n" f"element vertex {n}\n"
           + "".join(f"property float {p}\n" for p in props) + "end_header\n").encode()
    f_dc = (rgb - .5) / SH_C0
    f_rest = RNG.normal(0, .02, (n, 45))                                 # weak view dependence
    arr = np.hstack([xyz, np.zeros((n,3)), f_dc, f_rest,
                     np.log(opacity/(1-opacity))[:,None], np.log(scales),
                     np.tile([1.,0.,0.,0.], (n,1))]).astype(np.float32)
    assert arr.shape[1] == 62
    with open(path, "wb") as fh: fh.write(hdr); fh.write(arr.tobytes())
    return n

truth = {"commits": [], "objects": [{"name": nm, "commits": cs} for nm,_,cs in OBJECTS], "room_m": [W, D, H]}
for ci, (msg, ts) in enumerate(COMMITS):
    pts, cols = shell(); present = []
    for name, gen, commits in OBJECTS:
        if ci in commits:
            p, c = gen()
            if ci == 1 and name in MOVED_IN_C1: p = p + MOVED_IN_C1[name]
            pts = np.vstack([pts, p]); cols = np.vstack([cols, c]); present.append(name)
    pts += RNG.normal(0, .006, pts.shape); cols = np.clip(cols + RNG.normal(0, .012, cols.shape), 0, 1)
    nf = 1600                                                            # floaters
    pts = np.vstack([pts, np.c_[RNG.uniform(-W/2,W/2,nf), RNG.uniform(-D/2,D/2,nf), RNG.uniform(.2,H,nf)]])
    cols = np.vstack([cols, RNG.uniform(.2,.7,(nf,3))])
    op = np.r_[np.full(len(pts)-nf, .92), np.full(nf, .15)]
    # realistic splat size: each gaussian covers its neighbours (~0.75 x local spacing), floaters bigger & faint
    from scipy.spatial import cKDTree
    nn, _ = cKDTree(pts[:-nf]).query(pts[:-nf], k=4, workers=-1); spacing = nn[:, 1:].mean(1)
    sc = np.full((len(pts),3), .02); sc[:-nf] = (0.75 * spacing)[:, None] * (1 + RNG.normal(0, .2, (len(pts)-nf, 1)))
    sc[-nf:] = RNG.uniform(.02, .08, (nf, 1)); sc = np.clip(sc, .004, .12)
    R, t, s = rigid_and_scale(100 + ci)                                  # Teleport-style: own frame, own scale
    n = write_ply(f"{OUT}/c{ci}.ply", s*(pts @ R.T) + t, cols, sc*s, op)
    truth["commits"].append({"index": ci, "message": msg, "captured": ts, "file": f"c{ci}.ply",
                             "splats": n, "objects": present,
                             "frame": {"R": R.tolist(), "t": t.tolist(), "scale": s}})
    print(f"c{ci}  {n:>8,} splats  {os.path.getsize(f'{OUT}/c{ci}.ply')/1e6:6.1f} MB  scale {s:.2f}  {msg}")
json.dump(truth, open(f"{OUT}/truth.json","w"), indent=1)
