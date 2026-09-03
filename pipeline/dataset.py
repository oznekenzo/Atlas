"""
Dataset layout, dataset.json validation and per-step parameters.

A dataset lives at data/sets/<name>/:
  dataset.json      commits (source files, messages, timestamps), calibration, tuning, object names
  raw/c<i>.ply      symlinks to the source captures (or the captures themselves)
  out/              transforms.json, objects.json, label grids, aligned plys
and publishes to viewer/public/sets/<name>/.

dataset.json keys:
  calibration_m   (required) tape-measured longest wall-to-wall span, metres
  commits         (required) [{"file": "/abs/or/relative.ply", "message": "...", "captured": "ISO-8601"}, ...]
  registration    optional RegisterParams overrides
  diff            optional DiffParams overrides
  bake            optional BakeParams overrides
  objects         optional {"<object id>": "name"}; applied at publish so re-baking never loses names
  exclude         optional [<object id>, ...]: detections to drop at publish (artefacts); the rest are renumbered
  Object ids in `objects` and `exclude` are the diff's ids (out/objects.json), so excluding one never shifts the others.
"""
import dataclasses
import json
import os
from dataclasses import dataclass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class PipelineError(Exception):
    """A user-facing failure: bad dataset.json, missing file, registration rejected, ..."""


@dataclass
class RegisterParams:
    up: str = "auto"                     # "auto": floor is the denser end of the vertical range
                                         # "keep": the largest horizontal plane is the floor
                                         # "flip": the largest horizontal plane is the ceiling
    min_inlier_frac: float = 0.4         # reject a registration with fewer inliers (fraction of source points)
    min_candidate_margin: float = 0.05   # best symmetry candidate must beat the runner-up by this much fitness


@dataclass
class DiffParams:
    wall_margin_m: float = 0.0           # objects whose centroid lies this close to a wall are ignored
    voxel_frac: float = 0.008            # voxel size as a fraction of the room span
    min_voxels: int = 60                 # smallest blob that counts as an object
    jitter_voxels: int = 2               # positional slop tolerated before something counts as changed
    coverage_voxels: int = 12            # "observed" = within this distance of the other capture's geometry
    coverage_frac: float = 0.25          # a candidate survives if this fraction of it is observed
    opacity_solid: float = 0.2           # a voxel is occupied if it holds >= min_count splats at least this opaque
    min_count: int = 2
    label_dilate_voxels: int = 2         # how far an object's label reaches to catch its thin parts
    floor_band_voxels: int = 2           # a candidate mostly this close to the floor is a floor patch
    floor_frac: float = 0.8
    ceiling_band_voxels: int = 6         # a candidate whose median lies this close to the ceiling (or that pokes
                                         # through it) is a fixture or noise, not an object


@dataclass
class BakeParams:
    prune_opacity: float = 0.05          # drop splats fainter than this before writing
    sh: int = 0                          # spherical-harmonic degree written to SPZ (0 or 1)


@dataclass
class Commit:
    index: int
    file: str                            # absolute path of the source capture
    message: str
    captured: str


def _params(cls, block, section):
    """Build a params dataclass from a dataset.json block, rejecting unknown keys."""
    if block is None:
        return cls()
    if not isinstance(block, dict):
        raise PipelineError(f"dataset.json: '{section}' must be an object")
    fields = {f.name: f.type for f in dataclasses.fields(cls)}
    unknown = sorted(set(block) - set(fields))
    if unknown:
        raise PipelineError(f"dataset.json: unknown key(s) in '{section}': {', '.join(unknown)}; "
                            f"known: {', '.join(fields)}")
    values = {}
    for key, value in block.items():
        try:
            values[key] = fields[key](value)
        except (TypeError, ValueError):
            raise PipelineError(f"dataset.json: '{section}.{key}' must be {fields[key].__name__}, got {value!r}")
    return cls(**values)


class Dataset:
    """Paths and validated configuration for one set of captures."""

    def __init__(self, name, root=ROOT):
        self.name = name
        self.root = root
        self.dir = os.path.join(root, "data", "sets", name)
        self.raw_dir = os.path.join(self.dir, "raw")
        self.out_dir = os.path.join(self.dir, "out")
        self.pub_dir = os.path.join(root, "viewer", "public", "sets", name)
        self.json_path = os.path.join(self.dir, "dataset.json")
        if not os.path.exists(self.json_path):
            raise PipelineError(f"no dataset at {self.json_path}")
        with open(self.json_path) as fh:
            try:
                spec = json.load(fh)
            except json.JSONDecodeError as e:
                raise PipelineError(f"{self.json_path}: invalid JSON ({e})")
        self._parse(spec)

    def _parse(self, spec):
        for key in ("calibration_m", "commits"):
            if key not in spec:
                raise PipelineError(f"{self.json_path}: missing required key '{key}'")
        try:
            self.calibration_m = float(spec["calibration_m"])
        except (TypeError, ValueError):
            raise PipelineError(f"{self.json_path}: 'calibration_m' must be a number")
        if self.calibration_m <= 0:
            raise PipelineError(f"{self.json_path}: 'calibration_m' must be positive")
        if not isinstance(spec["commits"], list) or len(spec["commits"]) < 1:
            raise PipelineError(f"{self.json_path}: 'commits' must be a non-empty list")
        self.commits = []
        for i, c in enumerate(spec["commits"]):
            for key in ("file", "message", "captured"):
                if key not in c:
                    raise PipelineError(f"{self.json_path}: commits[{i}] is missing '{key}'")
            src = c["file"] if os.path.isabs(c["file"]) else os.path.join(self.dir, c["file"])
            src = os.path.abspath(src)
            if not os.path.exists(src):
                raise PipelineError(f"{self.json_path}: commits[{i}] capture not found: {src}")
            self.commits.append(Commit(i, src, str(c["message"]), str(c["captured"])))
        self.register = _params(RegisterParams, spec.get("registration"), "registration")
        if self.register.up not in ("auto", "flip", "keep"):
            raise PipelineError(f"{self.json_path}: registration.up must be 'auto', 'flip' or 'keep'")
        self.diff = _params(DiffParams, spec.get("diff"), "diff")
        self.bake = _params(BakeParams, spec.get("bake"), "bake")
        self.object_names = {}
        for key, value in (spec.get("objects") or {}).items():
            if not str(key).isdigit():
                raise PipelineError(f"{self.json_path}: 'objects' keys must be object ids, got {key!r}")
            self.object_names[int(key)] = str(value)
        exclude = spec.get("exclude") or []
        if not isinstance(exclude, list) or not all(isinstance(i, int) and i >= 0 for i in exclude):
            raise PipelineError(f"{self.json_path}: 'exclude' must be a list of object ids")
        self.exclude = set(exclude)

    # ---- paths -------------------------------------------------------------------------------
    def raw_ply(self, i):
        return os.path.join(self.raw_dir, f"c{i}.ply")

    def aligned_ply(self, i):
        return os.path.join(self.out_dir, f"c{i}.aligned.ply")

    def labels_path(self, i):
        return os.path.join(self.out_dir, f"c{i}.labels.bin")

    @property
    def transforms_path(self):
        return os.path.join(self.out_dir, "transforms.json")

    @property
    def objects_path(self):
        return os.path.join(self.out_dir, "objects.json")

    # ---- helpers -----------------------------------------------------------------------------
    def link_raw(self):
        """Point raw/c<i>.ply at each commit's capture; drop symlinks left over from an older commit list."""
        os.makedirs(self.raw_dir, exist_ok=True)
        os.makedirs(self.out_dir, exist_ok=True)
        wanted = {f"c{c.index}.ply" for c in self.commits}
        for entry in os.listdir(self.raw_dir):
            path = os.path.join(self.raw_dir, entry)
            stale = entry.startswith("c") and entry.endswith(".ply") and entry[1:-4].isdigit() and entry not in wanted
            if stale and os.path.islink(path):
                os.remove(path)
        for c in self.commits:
            dst = self.raw_ply(c.index)
            if os.path.exists(dst) and os.path.realpath(dst) == os.path.realpath(c.file):
                continue
            if os.path.islink(dst):
                os.remove(dst)
            elif os.path.exists(dst):
                raise PipelineError(f"{dst} exists and is not a symlink; refusing to overwrite it")
            os.symlink(c.file, dst)

    def load_transforms(self):
        if not os.path.exists(self.transforms_path):
            raise PipelineError(f"{self.transforms_path} not found: run the register step first")
        with open(self.transforms_path) as fh:
            return json.load(fh)

    def load_objects(self):
        if not os.path.exists(self.objects_path):
            raise PipelineError(f"{self.objects_path} not found: run the diff step first")
        with open(self.objects_path) as fh:
            return json.load(fh)
