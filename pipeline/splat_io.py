"""Read / write 3DGS .ply (binary little-endian, arbitrary property order)."""
import numpy as np

SH_C0 = 0.28209479177387814

def read_ply(path):
    with open(path, "rb") as f:
        props, n = [], 0
        while True:
            line = f.readline().decode("ascii").strip()
            if line.startswith("element vertex"): n = int(line.split()[-1])
            elif line.startswith("property"):
                t, name = line.split()[1:]; props.append((name, t))
            elif line == "end_header": break
        assert all(t in ("float", "float32") for _, t in props), "only float32 props supported"
        names = [p[0] for p in props]
        arr = np.frombuffer(f.read(n * 4 * len(names)), dtype="<f4").reshape(n, len(names))
    col = {nm: i for i, nm in enumerate(names)}
    g = lambda *ks: arr[:, [col[k] for k in ks]]
    d = {"xyz": g("x","y","z").astype(np.float64),
         "scale": np.exp(g("scale_0","scale_1","scale_2")),
         "opacity": 1/(1+np.exp(-arr[:, col["opacity"]])),
         "rgb": np.clip(.5 + SH_C0 * g("f_dc_0","f_dc_1","f_dc_2"), 0, 1),
         "raw": arr, "names": names}
    return d

def write_ply(path, raw, names):
    hdr = ("ply\nformat binary_little_endian 1.0\n" f"element vertex {len(raw)}\n"
           + "".join(f"property float {p}\n" for p in names) + "end_header\n").encode()
    with open(path, "wb") as fh: fh.write(hdr); fh.write(np.ascontiguousarray(raw, dtype="<f4").tobytes())

def transform_raw(raw, names, T):
    """Apply a 4x4 similarity (rotation + translation + uniform scale) to a raw splat array in place."""
    col = {nm: i for i, nm in enumerate(names)}
    R = T[:3,:3]; t = T[:3,3]; s = np.cbrt(np.linalg.det(R)); Rn = R / s
    xyz = raw[:, [col["x"],col["y"],col["z"]]].astype(np.float64)
    raw[:, [col["x"],col["y"],col["z"]]] = (xyz @ R.T + t).astype(np.float32)
    raw[:, [col["scale_0"],col["scale_1"],col["scale_2"]]] += np.float32(np.log(s))
    # rotate quaternion (w,x,y,z) by Rn
    q = raw[:, [col["rot_0"],col["rot_1"],col["rot_2"],col["rot_3"]]].astype(np.float64)
    qr = _mat_to_quat(Rn)
    raw[:, [col["rot_0"],col["rot_1"],col["rot_2"],col["rot_3"]]] = _quat_mul(qr[None], q).astype(np.float32)
    return raw

def _mat_to_quat(R):
    tr = np.trace(R)
    if tr > 0:
        S = np.sqrt(tr + 1) * 2; return np.array([.25*S, (R[2,1]-R[1,2])/S, (R[0,2]-R[2,0])/S, (R[1,0]-R[0,1])/S])
    i = np.argmax(np.diag(R))
    if i == 0:
        S = np.sqrt(1+R[0,0]-R[1,1]-R[2,2])*2; return np.array([(R[2,1]-R[1,2])/S, .25*S, (R[0,1]+R[1,0])/S, (R[0,2]+R[2,0])/S])
    if i == 1:
        S = np.sqrt(1+R[1,1]-R[0,0]-R[2,2])*2; return np.array([(R[0,2]-R[2,0])/S, (R[0,1]+R[1,0])/S, .25*S, (R[1,2]+R[2,1])/S])
    S = np.sqrt(1+R[2,2]-R[0,0]-R[1,1])*2; return np.array([(R[1,0]-R[0,1])/S, (R[0,2]+R[2,0])/S, (R[1,2]+R[2,1])/S, .25*S])

def _quat_mul(a, b):
    w1,x1,y1,z1 = a[:,0],a[:,1],a[:,2],a[:,3]; w2,x2,y2,z2 = b[:,0],b[:,1],b[:,2],b[:,3]
    return np.c_[w1*w2-x1*x2-y1*y2-z1*z2, w1*x2+x1*w2+y1*z2-z1*y2, w1*y2-x1*z2+y1*w2+z1*x2, w1*z2+x1*y2-y1*x2+z1*w2]
