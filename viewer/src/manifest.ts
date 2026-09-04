/**
 * Manifest validation. The viewer trusts nothing about `commits.json` until it has passed here:
 * a bad bake fails loudly with a message that names the field, not deep inside the engine.
 */
import type { Commit, Manifest, Obj } from "./types";

class ManifestError extends Error {
  constructor(path: string, msg: string) {
    super(`commits.json: ${path} ${msg}`);
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const nums = (v: unknown, path: string, len?: number): number[] => {
  if (!Array.isArray(v) || !v.every(isNum)) throw new ManifestError(path, "must be a number array");
  if (len !== undefined && v.length !== len) throw new ManifestError(path, `must have ${len} entries`);
  return v;
};

const str = (v: unknown, path: string): string => {
  if (!isStr(v) || !v) throw new ManifestError(path, "must be a non-empty string");
  return v;
};

const num = (v: unknown, path: string): number => {
  if (!isNum(v)) throw new ManifestError(path, "must be a finite number");
  return v;
};

const commit = (v: unknown, i: number): Commit => {
  const p = `commits[${i}]`;
  if (!isObj(v)) throw new ManifestError(p, "must be an object");
  const index = num(v.index, `${p}.index`);
  if (index !== i) throw new ManifestError(`${p}.index`, `must equal ${i}`);
  const file = str(v.file, `${p}.file`);
  const labels = str(v.labels, `${p}.labels`);
  if (file.includes("..") || labels.includes("..")) throw new ManifestError(p, "paths must stay inside the set");
  return {
    id: str(v.id, `${p}.id`),
    index,
    hash: str(v.hash, `${p}.hash`),
    message: isStr(v.message) ? v.message : "",
    captured: isStr(v.captured) ? v.captured : "",
    file,
    labels,
    splats: isNum(v.splats) ? v.splats : 0,
  };
};

const object = (v: unknown, i: number, nCommits: number, nObjects: number): Obj => {
  const p = `objects[${i}]`;
  if (!isObj(v)) throw new ManifestError(p, "must be an object");
  const id = num(v.id, `${p}.id`);
  if (id !== i) throw new ManifestError(`${p}.id`, `must equal ${i}`);
  const present = nums(v.present, `${p}.present`);
  if (present.some((c) => c < 0 || c >= nCommits)) throw new ManifestError(`${p}.present`, "references a missing commit");
  const added_in = num(v.added_in, `${p}.added_in`);
  const link = (x: unknown, field: string) => {
    if (x === null || x === undefined) return null;
    const n = num(x, `${p}.${field}`);
    if (n < 0 || n >= nObjects) throw new ManifestError(`${p}.${field}`, "references a missing object");
    return n;
  };
  const removed_in = v.removed_in === null ? null : num(v.removed_in, `${p}.removed_in`);
  if (!Array.isArray(v.bbox) || v.bbox.length !== 2) throw new ManifestError(`${p}.bbox`, "must be [lo, hi]");
  const bbox: [number[], number[]] = [nums(v.bbox[0], `${p}.bbox[0]`, 3), nums(v.bbox[1], `${p}.bbox[1]`, 3)];
  return {
    id,
    name: isStr(v.name) && v.name ? v.name : `object ${id}`,
    added_in,
    removed_in,
    present,
    moved_from: link(v.moved_from, "moved_from"),
    moved_to: link(v.moved_to, "moved_to"),
    doc: isStr(v.doc) && v.doc ? v.doc : null,
    bbox,
    voxels: isNum(v.voxels) ? v.voxels : 0,
    volume_vox_m3: isNum(v.volume_vox_m3) ? v.volume_vox_m3 : 0,
  };
};

export function parseManifest(raw: unknown): Manifest {
  if (!isObj(raw)) throw new ManifestError("", "is not an object");
  if (!Array.isArray(raw.commits) || raw.commits.length === 0) throw new ManifestError("commits", "must be a non-empty array");
  const commits = raw.commits.map(commit);
  if (!Array.isArray(raw.objects)) throw new ManifestError("objects", "must be an array");
  const rawObjects: unknown[] = raw.objects;
  const objects = rawObjects.map((o, i) => object(o, i, commits.length, rawObjects.length));
  const shape = nums(raw.shape, "shape", 3);
  if (shape.some((s) => s < 1 || !Number.isInteger(s))) throw new ManifestError("shape", "must be positive integers");
  if (!Array.isArray(raw.world_from_ref) || raw.world_from_ref.length < 3) throw new ManifestError("world_from_ref", "must be a 3×4 or 4×4 matrix");
  const world_from_ref = raw.world_from_ref.slice(0, 3).map((r, i) => nums(r, `world_from_ref[${i}]`).slice(0, 4));
  if (world_from_ref.some((r) => r.length !== 4)) throw new ManifestError("world_from_ref", "rows must have 4 entries");
  let room: Manifest["room"] = null;
  if (raw.room !== undefined && raw.room !== null) {
    if (!Array.isArray(raw.room) || raw.room.length !== 2) throw new ManifestError("room", "must be [lo, hi]");
    room = [nums(raw.room[0], "room[0]", 3), nums(raw.room[1], "room[1]", 3)];
  }
  const voxel = num(raw.voxel, "voxel");
  if (voxel <= 0) throw new ManifestError("voxel", "must be positive");
  return {
    commits,
    objects,
    voxel,
    origin: nums(raw.origin, "origin", 3),
    shape,
    room,
    world_from_ref,
    calibration_m: isNum(raw.calibration_m) ? raw.calibration_m : 1,
  };
}
