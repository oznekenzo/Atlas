"""
Register commits c1..cN onto c0 with a SIMILARITY transform (rotation+translation+scale).
Teleport captures are not metric and each lands in its own frame.

Generic FPFH+RANSAC fails on rooms (near-symmetric boxes, planar, few distinct features).
So we use the room itself:
  1. canonicalize each capture: largest plane -> "floor" (z=0), dominant wall direction -> x axis,
     centre on the wall-to-wall midpoints, scale by the wall-to-wall extent  (Manhattan-world frame)
  2. the only ambiguity left is the box symmetry: 4 yaws x 2 up/down flips = 8 candidates
  3. score each candidate with a short ICP, keep the best
  4. refine: trimmed nearest-neighbour -> Umeyama similarity, tightening threshold
Changed contents are outliers by construction and are trimmed away in step 4.
"""
import numpy as np, open3d as o3d, json, os, time
from splat_io import read_ply
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATA = os.environ.get("PATINA_DATA", os.path.join(ROOT, "data")); RAW = os.path.join(DATA, "raw"); OUT = os.path.join(DATA, "out")
N_COMMITS = len([f for f in os.listdir(RAW) if f.startswith("c") and f.endswith(".ply") and f[1:-4].isdigit()])
os.makedirs(OUT, exist_ok=True)

def to_pcd(d, opacity_min=.35, crop=(5, 95), expand=0.20):
    """Solid splats only, cropped to the room: real captures carry background splats hundreds of units away."""
    keep = d["opacity"] > opacity_min; p = d["xyz"][keep]
    lo, hi = np.percentile(p, crop[0], axis=0), np.percentile(p, crop[1], axis=0); pad = (hi - lo) * expand
    inside = np.all((p > lo - pad) & (p < hi + pad), axis=1)
    return o3d.geometry.PointCloud(o3d.utility.Vector3dVector(p[inside]))

def largest_plane(p, thr):
    model, idx = p.segment_plane(distance_threshold=thr, ransac_n=3, num_iterations=2000)
    return np.array(model[:3]), model[3], np.asarray(idx)

def canonicalize(p):
    """4x4 T mapping raw -> room frame: largest horizontal plane defines 'up' (sign arbitrary), dominant wall defines yaw,
    centred on the room's midpoint, scaled to unit span. The 8 box-symmetry candidates resolve the remaining ambiguity."""
    ext = np.linalg.norm(p.get_axis_aligned_bounding_box().get_extent())
    q = p.voxel_down_sample(ext * 0.004); P = np.asarray(q.points)
    n, d, floor_idx = largest_plane(q, ext * 0.004)
    z = n / np.linalg.norm(n)
    a = np.cross(z, [0, 0, 1]); s = np.linalg.norm(a); c = np.dot(z, [0, 0, 1])
    if s < 1e-8: R1 = np.eye(3) if c > 0 else np.diag([1, -1, -1])
    else:
        K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]]) / s
        R1 = np.eye(3) + s * K + (1 - c) * K @ K
    Pz = P @ R1.T
    rest = np.delete(Pz, floor_idx, axis=0)
    # walls: peel planes off the remainder, skipping horizontal ones; blank drywall is sparse, so be patient
    rq = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(rest)); wn = None
    for _ in range(12):
        if len(rq.points) < 300: break
        n2, _, idx2 = largest_plane(rq, ext * 0.004)
        if abs(n2[2] / np.linalg.norm(n2)) < 0.3 and len(idx2) > 80: wn = n2; break
        rq = rq.select_by_index(idx2, invert=True)
    if wn is None:   # fallback: principal horizontal direction of the room
        xy = Pz[:, :2] - Pz[:, :2].mean(0); _, _, Vt = np.linalg.svd(xy, full_matrices=False); wn = np.r_[Vt[1], 0]
    wn = wn.copy(); wn[2] = 0; wn /= np.linalg.norm(wn)
    yaw = -np.arctan2(wn[1], wn[0])
    R2 = np.array([[np.cos(yaw), -np.sin(yaw), 0], [np.sin(yaw), np.cos(yaw), 0], [0, 0, 1]])
    Pc = Pz @ R2.T
    lo, hi = np.percentile(Pc, 2, axis=0), np.percentile(Pc, 98, axis=0)
    centre = (lo + hi) / 2; span = float((hi - lo)[:2].max())
    T = np.eye(4); R = R2 @ R1
    T[:3, :3] = R / span; T[:3, 3] = -centre / span
    return T

def apply(P, T): return P @ T[:3, :3].T + T[:3, 3]

def candidates():
    out = []
    for flip in (False, True):
        F = np.diag([1, -1, -1]) if flip else np.eye(3)          # 180 deg about x: swaps up/down, proper rotation
        for k in range(4):
            a = k * np.pi / 2
            Rz = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
            T = np.eye(4); T[:3, :3] = Rz @ F; out.append(T)
    return out

def icp_score(src, dst, T, thr):
    """Coarse-to-fine ICP (similarity) in the unit room frame: wide capture radius first, then tighten. Returns fit at the tight radius."""
    for r in (thr * 4, thr * 2, thr):
        res = o3d.pipelines.registration.registration_icp(
            src, dst, r, T, o3d.pipelines.registration.TransformationEstimationPointToPoint(with_scaling=True),
            o3d.pipelines.registration.ICPConvergenceCriteria(max_iteration=30))
        T = res.transformation
    return T, res.fitness, res.inlier_rmse

def umeyama(src, dst):
    ms, md = src.mean(0), dst.mean(0); S, Dd = src - ms, dst - md
    C = Dd.T @ S / len(src); U, sig, Vt = np.linalg.svd(C)
    d = np.ones(3); d[2] = np.sign(np.linalg.det(U) * np.linalg.det(Vt))
    R = U @ np.diag(d) @ Vt; s = (sig * d).sum() / (S ** 2).sum(axis=1).mean()
    t = md - s * R @ ms; T = np.eye(4); T[:3, :3] = s * R; T[:3, 3] = t; return T

def refine(src, dst, T0, iters=10):
    """Trimmed nearest-neighbour -> Umeyama similarity, thresholds annealed relative to the room's size."""
    from scipy.spatial import cKDTree
    span = float(np.linalg.norm(dst.get_axis_aligned_bounding_box().get_extent()))
    s = src.voxel_down_sample(span * 0.0015); d = dst.voxel_down_sample(span * 0.0015)
    D = np.asarray(d.points); P = np.asarray(s.points); tree = cKDTree(D); T = T0.copy()
    thr = span * 0.04; floor_thr = span * 0.003
    for _ in range(iters):
        dist, idx = tree.query(apply(P, T), workers=-1); inl = dist < thr
        if inl.sum() < 500: break
        T = umeyama(P[inl], D[idx[inl]]); thr = max(floor_thr, thr * 0.7)
    dist, _ = tree.query(apply(P, T), workers=-1); inl = dist < span * 0.005
    return T, float(inl.mean()), float(np.sqrt((dist[inl] ** 2).mean()) / span)

def register(src, ref, ref_canon=None):
    Tr = canonicalize(ref) if ref_canon is None else ref_canon
    Ts = canonicalize(src)
    sN = o3d.geometry.PointCloud(src); sN.transform(Ts); sN = sN.voxel_down_sample(0.008)   # unit room frame
    rN = o3d.geometry.PointCloud(ref); rN.transform(Tr); rN = rN.voxel_down_sample(0.008)
    best = None
    for C in candidates():
        Tc, fit, rmse = icp_score(sN, rN, C, 0.015)
        if best is None or fit > best[1] + 1e-6 or (abs(fit - best[1]) < 1e-6 and rmse < best[2]):
            best = (Tc, fit, rmse)
    # compose: raw_src -> canon_src -> canon_ref -> raw_ref
    T0 = np.linalg.inv(Tr) @ best[0] @ Ts
    T, inlier_frac, rms = refine(src, ref, T0)
    return T, {"candidate_fitness": round(best[1], 3), "inlier_frac": round(inlier_frac, 3), "rms_mm": round(rms, 5)}

if __name__ == "__main__":
    t0 = time.time()
    ref = to_pcd(read_ply(f"{RAW}/c0.ply")); Tr = canonicalize(ref)
    transforms = {"c0": np.eye(4).tolist()}; report = {}
    for ci in range(1, N_COMMITS):
        src = to_pcd(read_ply(f"{RAW}/c{ci}.ply"))
        T, rep = register(src, ref, Tr)
        rep["scale"] = round(float(np.cbrt(np.linalg.det(T[:3, :3]))), 4)
        transforms[f"c{ci}"] = T.tolist(); report[f"c{ci}"] = rep
        print(f"c{ci}: cand fit {rep['candidate_fitness']:.2f}  inliers(0.5% span) {rep['inlier_frac']:.2f}  rms {rep['rms_mm']*100:.2f}% of span  scale {rep['scale']:.3f}")
    json.dump({"transforms": transforms, "report": report, "ref_canon": Tr.tolist()}, open(f"{OUT}/transforms.json", "w"), indent=1)
    print(f"done in {time.time() - t0:.0f}s")
