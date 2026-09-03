#!/usr/bin/env python3
"""
One command per dataset:  python3 pipeline/run.py <set-name> [--only register|diff|bake|publish]

Layout:
  data/sets/<name>/dataset.json      commits (source files, messages, timestamps) + calibration + tuning
  data/sets/<name>/raw/c<i>.ply      symlinks to the source captures (created here from dataset.json)
  data/sets/<name>/out/              transforms.json, objects.json, label grids, aligned plys
  viewer/public/sets/<name>/         what the viewer loads

dataset.json:
{ "calibration_m": 6.1,                       # tape-measured longest wall-to-wall span
  "commits": [ {"file": "/abs/or/relative.ply", "message": "…", "captured": "ISO-8601"}, … ],
  "registration": { "up": "auto", "min_inlier_frac": 0.4, "min_candidate_margin": 0.05 },
  "diff": { "wall_margin_m": 0.6, "voxel_frac": 0.008, "min_voxels": 60, "jitter_voxels": 2,
            "coverage_voxels": 12, "coverage_frac": 0.25, "opacity_solid": 0.2, "min_count": 2,
            "label_dilate_voxels": 2, "floor_band_voxels": 2, "floor_frac": 0.8, "ceiling_band_voxels": 6 },
  "bake": { "prune_opacity": 0.05, "sh": 0 },
  "objects": { "6": "Floor lamp" },           # optional names by object id (the diff's ids), applied at publish
  "exclude": [8, 12] }                        # optional: detections that are artefacts, dropped at publish
All blocks but calibration_m and commits are optional; see dataset.py for the defaults.
bake = aligned plys + .spz + publish; `--only publish` rewrites labels + commits.json alone (names, exclusions).
"""
import argparse
import logging
import sys

import bake
import diff
from dataset import Dataset, PipelineError


def _register(ds):
    import register  # open3d: only the register step needs it, so diff / bake / publish run without it

    register.run(ds)


STEPS = {"register": _register, "diff": diff.run, "bake": bake.run, "publish": bake.publish}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Register, diff and bake one set of captures.")
    parser.add_argument("set", help="name of the dataset under data/sets/")
    parser.add_argument("--only", choices=sorted(STEPS), help="run a single step instead of register, diff, bake")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        ds = Dataset(args.set)
        ds.link_raw()
        for step in ([args.only] if args.only else ["register", "diff", "bake"]):
            print(f"\n=== {step} ({ds.name}) ===", flush=True)
            STEPS[step](ds)
    except PipelineError as e:
        sys.exit(f"error: {e}")
    print(f"\ndone -> {ds.pub_dir}   (open the viewer with ?set={ds.name})")


if __name__ == "__main__":
    main()
