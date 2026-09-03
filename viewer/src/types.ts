export type Commit = { id: string; index: number; hash: string; message: string; captured: string; file: string; splats: number; labels: string };
export type Obj = {
  id: number;
  name: string;
  added_in: number;
  removed_in: number | null;
  present: number[];
  /** The same physical object before/after it was moved, if the tracker matched one. */
  moved_from: number | null;
  moved_to: number | null;
  /** World space (metres, y up), aligned to the room: tight, and usable as-is. */
  bbox: [number[], number[]];
  voxels: number;
  volume_vox_m3: number;
};
export type Manifest = {
  commits: Commit[];
  objects: Obj[];
  voxel: number;
  origin: number[];
  shape: number[];
  /** Room box in world space (walls, floor at y = 0, ceiling). Older bakes lack it; the voxel grid extent stands in. */
  room: [number[], number[]] | null;
  world_from_ref: number[][];
  calibration_m: number;
};
