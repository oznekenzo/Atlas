"""
Slim a 3DGS capture to what the pipeline needs: drop the SH bands and normals, prune near-invisible splats.

    python3 pipeline/slim_ply.py <in.ply> <out.ply> [--min-opacity 0.05]

A full SH3 export is 236 B/splat; the pipeline registers and diffs on positions and opacity, and real sets are
baked at SH0 (view-dependent colour is noise on a phone capture), so 14 floats/splat is all that survives.
Runs on numpy alone, in chunks, so it works anywhere — including machines that cannot install Open3D.
"""
import argparse
import os
import sys

import numpy as np

KEEP = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
CHUNK = 500_000


def read_header(fh):
    if fh.readline().strip() != b"ply":
        sys.exit("not a ply")
    names, n = [], None
    while True:
        words = fh.readline().decode("ascii", errors="replace").split()
        if not words:
            continue
        if words[0] == "format" and words[1] != "binary_little_endian":
            sys.exit(f"unsupported format {words[1]}")
        if words[0] == "element":
            if words[1] != "vertex":
                sys.exit(f"unsupported element {words[1]}")
            n = int(words[2])
        elif words[0] == "property":
            if words[1] not in ("float", "float32"):
                sys.exit(f"property {words[2]} is {words[1]}; only float32 is supported")
            names.append(words[2])
        elif words[0] == "end_header":
            return names, n, fh.tell()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--min-opacity", type=float, default=0.05, help="drop splats below this opacity (default 0.05)")
    a = ap.parse_args()
    with open(a.src, "rb") as fh:
        names, n, offset = read_header(fh)
    missing = [k for k in KEEP if k not in names]
    if missing:
        sys.exit(f"{a.src}: missing {missing}")
    cols = [names.index(k) for k in KEEP]
    op = KEEP.index("opacity")
    logit_min = np.log(a.min_opacity / (1 - a.min_opacity))
    raw = np.memmap(a.src, dtype="<f4", mode="r", offset=offset, shape=(n, len(names)))
    kept = 0
    body = a.dst + ".body"
    with open(body, "wb") as out:
        for s in range(0, n, CHUNK):
            block = np.asarray(raw[s:s + CHUNK][:, cols])
            block = block[np.isfinite(block).all(axis=1) & (block[:, op] >= logit_min)]
            out.write(np.ascontiguousarray(block, dtype="<f4").tobytes())
            kept += len(block)
            print(f"\r  {min(s + CHUNK, n):>10,} / {n:,}  kept {kept:,}", end="", file=sys.stderr, flush=True)
    header = ("ply\nformat binary_little_endian 1.0\n" f"element vertex {kept}\n"
              + "".join(f"property float {k}\n" for k in KEEP) + "end_header\n").encode()
    with open(body, "rb") as src, open(a.dst, "wb") as dst:
        dst.write(header)
        while chunk := src.read(64 << 20):
            dst.write(chunk)
    os.remove(body)
    print(f"\n{a.dst}: {kept:,} of {n:,} splats, {os.path.getsize(a.dst) / 1e6:.0f} MB", file=sys.stderr)


if __name__ == "__main__":
    main()
