"""
Read / write / transform 3DGS .ply files (binary little-endian, float32 properties, any property order).

read_ply returns the splat table as a read-only memmap plus the derived arrays the pipeline needs
(positions, opacities). transform_raw applies a similarity to a writable copy of that table.
"""
import os

import numpy as np

SH_C0 = 0.28209479177387814
FLOAT_TYPES = ("float", "float32")


class PlyError(Exception):
    """Malformed or unsupported .ply."""


def _read_header(fh, path):
    """Parse the ASCII header; returns (property names, vertex count, byte offset of the body)."""
    magic = fh.readline()
    if magic.strip() != b"ply":
        raise PlyError(f"{path}: not a ply file")
    names = []
    n = None
    fmt = None
    while True:
        line = fh.readline()
        if not line:
            raise PlyError(f"{path}: header has no end_header")
        text = line.decode("ascii", errors="replace").strip()
        words = text.split()
        if not words:
            continue
        if words[0] == "format":
            fmt = words[1]
        elif words[0] == "element":
            if words[1] != "vertex":
                raise PlyError(f"{path}: only a single 'vertex' element is supported, found '{words[1]}'")
            n = int(words[2])
        elif words[0] == "property":
            if words[1] not in FLOAT_TYPES:
                raise PlyError(f"{path}: property '{words[2]}' is {words[1]}; only float32 properties are supported")
            names.append(words[2])
        elif words[0] == "end_header":
            break
    if fmt != "binary_little_endian":
        raise PlyError(f"{path}: format must be binary_little_endian, got {fmt}")
    if n is None:
        raise PlyError(f"{path}: header has no 'element vertex'")
    if not names:
        raise PlyError(f"{path}: header has no properties")
    return names, n, fh.tell()


def read_ply(path):
    """Read a 3DGS ply. Returns {"xyz": float64 (n,3), "opacity": float64 (n,), "raw": read-only memmap
    (n, nprops) float32, "names": property names}."""
    with open(path, "rb") as fh:
        names, n, offset = _read_header(fh, path)
    expected = n * len(names) * 4
    actual = os.path.getsize(path) - offset
    if actual != expected:
        raise PlyError(f"{path}: body is {actual} bytes, header promises {n} x {len(names)} floats = {expected} bytes")
    for required in ("x", "y", "z", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"):
        if required not in names:
            raise PlyError(f"{path}: missing property '{required}'")
    raw = np.memmap(path, dtype="<f4", mode="r", offset=offset, shape=(n, len(names)))
    col = {name: i for i, name in enumerate(names)}
    xyz = np.asarray(raw[:, [col["x"], col["y"], col["z"]]], dtype=np.float64)
    opacity = 1.0 / (1.0 + np.exp(-np.asarray(raw[:, col["opacity"]], dtype=np.float64)))
    return {"xyz": xyz, "opacity": opacity, "raw": raw, "names": names}


def write_ply(path, raw, names):
    header = ("ply\nformat binary_little_endian 1.0\n"
              f"element vertex {len(raw)}\n"
              + "".join(f"property float {p}\n" for p in names)
              + "end_header\n").encode()
    with open(path, "wb") as fh:
        fh.write(header)
        np.ascontiguousarray(raw, dtype="<f4").tofile(fh)


def sh_band_count(names):
    """Spherical-harmonic coefficients per channel carried by the ply (0, 3, 8 or 15)."""
    nrest = sum(1 for name in names if name.startswith("f_rest_"))
    if nrest % 3:
        raise PlyError(f"f_rest_* count {nrest} is not a multiple of 3")
    return nrest // 3


def transform_raw(raw, names, T):
    """Apply a 4x4 similarity (proper rotation + translation + uniform scale) to a writable splat table in place:
    positions, log-scales, quaternions and SH band 1. SH bands >= 2 are left untouched, so callers must not emit them."""
    col = {name: i for i, name in enumerate(names)}
    R = T[:3, :3]
    t = T[:3, 3]
    det = np.linalg.det(R)
    assert det > 0, f"transform_raw needs a proper rotation, det = {det:.4f}"
    s = np.cbrt(det)
    Rn = R / s
    xyz_cols = [col["x"], col["y"], col["z"]]
    xyz = raw[:, xyz_cols].astype(np.float64)
    raw[:, xyz_cols] = (xyz @ R.T + t).astype(np.float32)
    raw[:, [col["scale_0"], col["scale_1"], col["scale_2"]]] += np.float32(np.log(s))
    rot_cols = [col["rot_0"], col["rot_1"], col["rot_2"], col["rot_3"]]
    q = raw[:, rot_cols].astype(np.float64)
    qr = _mat_to_quat(Rn)
    raw[:, rot_cols] = _quat_mul(qr[None], q).astype(np.float32)
    K = sh_band_count(names)
    if K >= 3:
        _rotate_sh1(raw, col, K, Rn)
    return raw


def _rotate_sh1(raw, col, K, Rn):
    """Rotate the degree-1 SH coefficients of each colour channel. The ply stores f_rest channel-major
    (channel ch, coefficient c at f_rest_{ch*K + c}); band 1 is (c_{1,-1}, c_{1,0}, c_{1,1}) ~ (-y, z, -x),
    so the band is the vector v = (-c2, -c0, c1), which rotates as v' = R v, and c' = (-v'_y, v'_z, -v'_x)."""
    for ch in range(3):
        cols = [col[f"f_rest_{ch * K + c}"] for c in range(3)]
        c0, c1, c2 = (raw[:, k].astype(np.float64) for k in cols)
        v = np.stack([-c2, -c0, c1], axis=1)
        vr = v @ Rn.T
        raw[:, cols[0]] = (-vr[:, 1]).astype(np.float32)
        raw[:, cols[1]] = vr[:, 2].astype(np.float32)
        raw[:, cols[2]] = (-vr[:, 0]).astype(np.float32)


def _mat_to_quat(R):
    """Rotation matrix -> unit quaternion (w, x, y, z)."""
    tr = np.trace(R)
    if tr > 0:
        S = np.sqrt(tr + 1) * 2
        return np.array([.25 * S, (R[2, 1] - R[1, 2]) / S, (R[0, 2] - R[2, 0]) / S, (R[1, 0] - R[0, 1]) / S])
    i = np.argmax(np.diag(R))
    if i == 0:
        S = np.sqrt(1 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        return np.array([(R[2, 1] - R[1, 2]) / S, .25 * S, (R[0, 1] + R[1, 0]) / S, (R[0, 2] + R[2, 0]) / S])
    if i == 1:
        S = np.sqrt(1 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        return np.array([(R[0, 2] - R[2, 0]) / S, (R[0, 1] + R[1, 0]) / S, .25 * S, (R[1, 2] + R[2, 1]) / S])
    S = np.sqrt(1 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
    return np.array([(R[1, 0] - R[0, 1]) / S, (R[0, 2] + R[2, 0]) / S, (R[1, 2] + R[2, 1]) / S, .25 * S])


def _quat_mul(a, b):
    """Hamilton product of quaternion arrays (n,4) in (w, x, y, z) order; a broadcasts over b."""
    w1, x1, y1, z1 = a[:, 0], a[:, 1], a[:, 2], a[:, 3]
    w2, x2, y2, z2 = b[:, 0], b[:, 1], b[:, 2], b[:, 3]
    return np.c_[w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
                 w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                 w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                 w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2]
