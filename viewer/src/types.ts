export type Stats = { stoppages: string; changeover: string; output: string };
export type Commit = {
  id: string;
  index: number;
  hash: string;
  message: string;
  captured: string;
  file: string;
  splats: number;
  labels: string;
  /** The month's written entry and who signed it. Null when nobody wrote one; the viewer shows the absence. */
  doc: string | null;
  by: string | null;
  stats: Stats | null;
};
export type Obj = {
  id: number;
  name: string;
  added_in: number;
  removed_in: number | null;
  present: number[];
  /** The same physical object before/after it was moved, if the tracker matched one. */
  moved_from: number | null;
  moved_to: number | null;
  /** The object's written entry and who signed it, from the dataset. Null when there is none. */
  doc: string | null;
  by: string | null;
  /** World space (metres, y up), aligned to the room: tight, and usable as-is. */
  bbox: [number[], number[]];
  voxels: number;
  volume_vox_m3: number;
};
export type Entry = { doc: string | null; by: string | null };
/** One floor on the picker. `set` is the directory under sets/ the picker opens for it; null while it is a label only. */
export type Site = { id: string; name: string; count: number; set: string | null };
export type Manifest = {
  commits: Commit[];
  objects: Obj[];
  voxel: number;
  origin: number[];
  shape: number[];
  /** Room box in world space (walls, floor at y = 0, ceiling). Older bakes lack it; the voxel grid extent stands in. */
  room: [number[], number[]] | null;
  /** Where the camera stands when the set opens, and what it looks at. Null: a corner of the room at standing height. */
  view: { pos: number[]; target: number[] } | null;
  world_from_ref: number[][];
  calibration_m: number;
  /** The commit marked as the approved layout, or null when the set has none. */
  standard: number | null;
  /** Written entries for diffs, keyed "a-b". */
  diffs: Record<string, Entry>;
  /** The site picker. The first is this set; the rest are labels until their sets are imported. */
  sites: Site[];
};
