"""
Register commits c1..cN onto c0 with a SIMILARITY transform (rotation + translation + scale).
Teleport captures are not metric and each lands in its own frame.

Generic FPFH+RANSAC fails on rooms (near-symmetric boxes, planar, few distinct features).
So we use the room itself:
  1. canonicalize each capture: largest plane -> "floor" (z = 0 plane), walls -> x axis (inlier-weighted
     circular mean of vertical-plane normals modulo 90 deg), centre on the wall-to-wall midpoints,
     scale by the wall-to-wall extent  (Manhattan-world frame)
  2. the only ambiguity left is the box symmetry: 4 yaws x 2 up/down flips = 8 candidates
  3. score each candidate with a short ICP, keep the best; reject if it does not clearly beat the runner-up
  4. refine: trimmed nearest-neighbour -> Umeyama similarity, tightening threshold; reject on few inliers
Changed contents are outliers by construction and are trimmed away in step 4.

Up/down is decided ONCE here, for the reference: the floor is the denser end of the vertical range
(handheld captures see far more floor than ceiling), overridable with registration.up in dataset.json.
The flip and the floor-to-z=0 shift are folded into ref_canon, so downstream steps get a frame with
+z up, the floor at z = 0, and unit wall-to-wall span.

Writes out/transforms.json: {"transforms": {c<i>: 4x4}, "report": {...}, "ref_canon": 4x4}.
"""
import json
import logging
import sys
import time

import numpy as np
import open3d as o3d
from scipy.spatial import cKDTree

from dataset import Dataset, PipelineError
from splat_io import read_ply

log = logging.getLogger("register")

CANDIDATE_VOXEL = 0.008      # unit-frame voxel for the candidate ICP clouds
CANDIDATE_THR = 0.015        # tightest ICP capture radius (fraction of span)
MAX_WALL_PLANES = 8          # vertical planes that vote on the yaw
DISTINCT_POSE_DEG = 20.0     # candidates whose ICP results differ by less than this are the same pose


def seed_everything():
    """Open3D's RANSAC plane fits and numpy sampling must be reproducible run to run."""
    o3d.utility.random.seed(0)
    np.random.seed(0)


def to_pcd(d, opacity_min=.35, crop=(5, 95), expand=0.20):
    """Solid splats only, cropped to the room: real captures carry background splats hundreds of units away."""
    keep = d["opacity"] > opacity_min
    p = d["xyz"][keep]
    lo = np.percentile(p, crop[0], axis=0)
    hi = np.percentile(p, crop[1], axis=0)
    pad = (hi - lo) * expand
    inside = np.all((p > lo - pad) & (p < hi + pad), axis=1)
    return o3d.geometry.PointCloud(o3d.utility.Vector3dVector(p[inside]))


def largest_plane(p, thr):
    model, idx = p.segment_plane(distance_threshold=thr, ransac_n=3, num_iterations=2000)
    return np.array(model[:3]), model[3], np.asarray(idx)


def rotation_to_z(z):
    """Rotation taking unit vector z onto +z (Rodrigues)."""
    a = np.cross(z, [0, 0, 1])
    s = np.linalg.norm(a)
    c = np.dot(z, [0, 0, 1])
    if s < 1e-8:
        return np.eye(3) if c > 0 else np.diag([1, -1, -1])
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]]) / s
    return np.eye(3) + s * K + (1 - c) * K @ K


def yaw_matrix(yaw):
    return np.array([[np.cos(yaw), -np.sin(yaw), 0], [np.sin(yaw), np.cos(yaw), 0], [0, 0, 1]])


def yaw_from_walls(rest, thr):
    """Yaw (radians) that aligns the dominant wall direction with x. Peels vertical planes off the non-floor
    points and takes the inlier-count-weighted circular mean of their normal angles modulo 90 degrees;
    falls back to the principal horizontal direction when no vertical plane is found."""
    rq = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(rest))
    angles = []
    weights = []
    for _ in range(12):
        if len(rq.points) < 300 or len(angles) >= MAX_WALL_PLANES:
            break
        n, _, idx = largest_plane(rq, thr)
        n = n / np.linalg.norm(n)
        if abs(n[2]) < 0.3 and len(idx) > 80:
            angles.append(np.arctan2(n[1], n[0]))
            weights.append(len(idx))
        rq = rq.select_by_index(idx, invert=True)
    if angles:
        angles = np.array(angles)
        weights = np.array(weights, float)
        mean_4theta = np.arctan2((weights * np.sin(4 * angles)).sum(), (weights * np.cos(4 * angles)).sum())
        return -mean_4theta / 4, len(angles)
    xy = rest[:, :2] - rest[:, :2].mean(0)
    _, _, Vt = np.linalg.svd(xy, full_matrices=False)
    return -np.arctan2(Vt[1][1], Vt[1][0]), 0


def canonicalize(p):
    """4x4 T mapping raw -> geometric room frame: largest plane -> z = 0 with its normal pointing into the room,
    walls -> x axis with +x towards the denser half of the room (the wall normal's sign is arbitrary, this is not),
    centred on the room's midpoint, scaled to unit span. Which way is up and where the floor sits are resolved
    separately (resolve_up); the 8 box-symmetry candidates cover the rest."""
    ext = np.linalg.norm(p.get_axis_aligned_bounding_box().get_extent())
    thr = ext * 0.004
    q = p.voxel_down_sample(thr)
    P = np.asarray(q.points)
    n, d, floor_idx = largest_plane(q, thr)
    z = n / np.linalg.norm(n)
    rest = np.delete(P, floor_idx, axis=0)
    if np.mean(rest @ z + d / np.linalg.norm(n)) < 0:      # normal points into the room
        z = -z
    R1 = rotation_to_z(z)
    Pz = P @ R1.T
    yaw, n_walls = yaw_from_walls(np.delete(Pz, floor_idx, axis=0), thr)
    x = (Pz @ yaw_matrix(yaw).T)[:, 0]
    mid = np.percentile(x, [2, 98]).mean()
    if (x > mid).sum() < (x < mid).sum():
        yaw += np.pi                                        # +x points at the denser half of the room
    R2 = yaw_matrix(yaw)
    Pc = Pz @ R2.T
    lo = np.percentile(Pc, 2, axis=0)
    hi = np.percentile(Pc, 98, axis=0)
    centre = (lo + hi) / 2
    span = float((hi - lo)[:2].max())
    T = np.eye(4)
    T[:3, :3] = (R2 @ R1) / span
    T[:3, 3] = -centre / span
    return T, n_walls


def apply(P, T):
    return P @ T[:3, :3].T + T[:3, 3]


def resolve_up(p, T_geo, mode):
    """Decide which way is up in the geometric frame and where the floor is. Returns (ref_canon, info):
    ref_canon = floor-to-z=0 shift @ optional 180-degree flip about x @ T_geo."""
    q = apply(np.asarray(p.points), T_geo)
    q = q[np.all(np.abs(q) < 0.75, axis=1)]
    zlo, zhi = np.percentile(q[:, 2], [2, 98])
    h = zhi - zlo
    bottom = int((q[:, 2] < zlo + 0.15 * h).sum())
    top = int((q[:, 2] > zhi - 0.15 * h).sum())
    if mode == "auto":
        flip = top > bottom
    else:
        flip = mode == "flip"
    Tflip = np.diag([1.0, -1.0, -1.0, 1.0]) if flip else np.eye(4)     # proper rotation, swaps up/down
    floor_z = float(np.percentile((q @ Tflip[:3, :3].T)[:, 2], 2))
    Tfloor = np.eye(4)
    Tfloor[2, 3] = -floor_z
    info = {"mode": mode, "flipped": bool(flip), "bottom_pts": bottom, "top_pts": top,
            "bottom_top_ratio": round(bottom / max(top, 1), 3), "floor_z_geo": round(floor_z, 4)}
    return Tfloor @ Tflip @ T_geo, info


def candidates():
    out = []
    for flip in (False, True):
        F = np.diag([1, -1, -1]) if flip else np.eye(3)          # 180 deg about x: swaps up/down, proper rotation
        for k in range(4):
            a = k * np.pi / 2
            Rz = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
            T = np.eye(4)
            T[:3, :3] = Rz @ F
            out.append(T)
    return out


def icp_score(src, dst, T, thr):
    """Coarse-to-fine ICP (similarity) in the unit room frame: wide capture radius first, then tighten.
    Returns (T, fitness, rmse) at the tight radius."""
    estimation = o3d.pipelines.registration.TransformationEstimationPointToPoint(with_scaling=True)
    criteria = o3d.pipelines.registration.ICPConvergenceCriteria(max_iteration=30)
    for r in (thr * 4, thr * 2, thr):
        res = o3d.pipelines.registration.registration_icp(src, dst, r, T, estimation, criteria)
        T = res.transformation
    return T, res.fitness, res.inlier_rmse


def rotation_angle_deg(Ta, Tb):
    """Angle between the rotation parts of two similarity transforms."""
    Ra = Ta[:3, :3] / np.cbrt(np.linalg.det(Ta[:3, :3]))
    Rb = Tb[:3, :3] / np.cbrt(np.linalg.det(Tb[:3, :3]))
    cos = (np.trace(Ra.T @ Rb) - 1) / 2
    return float(np.degrees(np.arccos(np.clip(cos, -1, 1))))


def best_candidate(sN, rN):
    """Score all 8 symmetry candidates; returns (T, best fitness, runner-up fitness among distinct poses)."""
    scored = []
    for C in candidates():
        Tc, fit, rmse = icp_score(sN, rN, C, CANDIDATE_THR)
        scored.append((fit, -rmse, Tc))
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    best_fit, _, best_T = scored[0]
    runner_up = 0.0
    for fit, _, Tc in scored[1:]:
        if rotation_angle_deg(best_T, Tc) > DISTINCT_POSE_DEG:
            runner_up = fit
            break
    return best_T, best_fit, runner_up


def umeyama(src, dst):
    ms = src.mean(0)
    md = dst.mean(0)
    S = src - ms
    Dd = dst - md
    C = Dd.T @ S / len(src)
    U, sig, Vt = np.linalg.svd(C)
    d = np.ones(3)
    d[2] = np.sign(np.linalg.det(U) * np.linalg.det(Vt))
    R = U @ np.diag(d) @ Vt
    s = (sig * d).sum() / (S ** 2).sum(axis=1).mean()
    t = md - s * R @ ms
    T = np.eye(4)
    T[:3, :3] = s * R
    T[:3, 3] = t
    return T


class RefineTarget:
    """The reference cloud prepared once for refine(): downsampled points, KD-tree and size."""

    def __init__(self, ref):
        self.span = float(np.linalg.norm(ref.get_axis_aligned_bounding_box().get_extent()))
        self.points = np.asarray(ref.voxel_down_sample(self.span * 0.0015).points)
        self.tree = cKDTree(self.points)


def refine(src, target, T0, max_iters=40):
    """Trimmed nearest-neighbour -> Umeyama similarity, thresholds annealed relative to the room's size, then
    held at the floor until the estimate stops moving. Returns (T, inlier fraction at 0.5% of span, rms of
    those inliers as a fraction of span)."""
    span = target.span
    P = np.asarray(src.voxel_down_sample(span * 0.0015).points)
    probe = P[:: max(1, len(P) // 2000)]                    # a few points to measure how far the estimate moved
    T = T0.copy()
    thr = span * 0.04
    floor_thr = span * 0.003
    for _ in range(max_iters):
        dist, idx = target.tree.query(apply(P, T), workers=-1)
        inl = dist < thr
        if inl.sum() < 500:
            break
        T_new = umeyama(P[inl], target.points[idx[inl]])
        moved = np.linalg.norm(apply(probe, T_new) - apply(probe, T), axis=1).max()
        T = T_new
        if thr <= floor_thr and moved < 1e-5 * span:
            break
        thr = max(floor_thr, thr * 0.7)
    dist, _ = target.tree.query(apply(P, T), workers=-1)
    inl = dist < span * 0.005
    return T, float(inl.mean()), float(np.sqrt((dist[inl] ** 2).mean()) / span)


def register(src, ref_geo_T, rN, target, params, tag):
    """Register one source cloud onto the reference. rN is the reference in its geometric unit frame."""
    Ts, n_walls = canonicalize(src)
    sN = o3d.geometry.PointCloud(src)
    sN.transform(Ts)
    sN = sN.voxel_down_sample(CANDIDATE_VOXEL)
    best_T, best_fit, runner_up = best_candidate(sN, rN)
    T0 = np.linalg.inv(ref_geo_T) @ best_T @ Ts     # raw_src -> geo_src -> geo_ref -> raw_ref
    T, inlier_frac, rms = refine(src, target, T0)
    report = {"candidate_fitness": round(best_fit, 3), "runner_up_fitness": round(runner_up, 3),
              "candidate_margin": round(best_fit - runner_up, 3), "inlier_frac": round(inlier_frac, 3),
              "rms_frac_span": round(rms, 5), "scale": round(float(np.cbrt(np.linalg.det(T[:3, :3]))), 4),
              "wall_planes": n_walls}
    if inlier_frac < params.min_inlier_frac:
        raise PipelineError(f"{tag}: registration rejected, inlier fraction {inlier_frac:.2f} < "
                            f"min_inlier_frac {params.min_inlier_frac}")
    if best_fit - runner_up < params.min_candidate_margin:
        raise PipelineError(f"{tag}: registration ambiguous, best symmetry candidate fitness {best_fit:.3f} "
                            f"beats the runner-up {runner_up:.3f} by less than min_candidate_margin "
                            f"{params.min_candidate_margin}")
    return T, report


def run(ds):
    t0 = time.time()
    seed_everything()
    params = ds.register
    ref = to_pcd(read_ply(ds.raw_ply(0)))
    ref_geo_T, n_walls = canonicalize(ref)
    ref_canon, up = resolve_up(ref, ref_geo_T, params.up)
    log.info(f"c0: {n_walls} wall planes voted on the yaw; vertical density bottom {up['bottom_pts']:,} vs top "
             f"{up['top_pts']:,} (ratio {up['bottom_top_ratio']}) -> {'flipped' if up['flipped'] else 'kept'} "
             f"[{params.up}]; floor at z={up['floor_z_geo']:.3f} -> 0")
    rN = o3d.geometry.PointCloud(ref)
    rN.transform(ref_geo_T)
    rN = rN.voxel_down_sample(CANDIDATE_VOXEL)
    target = RefineTarget(ref)
    transforms = {"c0": np.eye(4).tolist()}
    report = {}
    for c in ds.commits[1:]:
        tag = f"c{c.index}"
        src = to_pcd(read_ply(c.file))
        T, rep = register(src, ref_geo_T, rN, target, params, tag)
        transforms[tag] = T.tolist()
        report[tag] = rep
        log.info(f"{tag}: cand fit {rep['candidate_fitness']:.3f} (runner-up {rep['runner_up_fitness']:.3f})  "
                 f"inliers(0.5% span) {rep['inlier_frac']:.2f}  rms {rep['rms_frac_span'] * 100:.2f}% of span  "
                 f"scale {rep['scale']:.3f}")
    with open(ds.transforms_path, "w") as fh:
        json.dump({"transforms": transforms, "report": report, "ref_canon": ref_canon.tolist(), "up": up}, fh, indent=1)
    log.info(f"register done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if len(sys.argv) != 2:
        sys.exit("usage: python3 register.py <set-name>")
    try:
        ds = Dataset(sys.argv[1])
        ds.link_raw()
        run(ds)
    except PipelineError as e:
        sys.exit(f"register: {e}")
