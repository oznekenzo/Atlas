export type Commit = { id: string; index: number; hash: string; message: string; captured: string;
  file: string; splats: number; labels: string };
export type Obj = { id: number; name: string; added_in: number; removed_in: number | null; present: number[];
  bbox: [number[], number[]]; voxels: number; volume_vox_m3: number };
export type Manifest = { commits: Commit[]; objects: Obj[]; voxel: number; origin: number[]; shape: number[];
  world_from_ref: number[][]; calibration_m: number };
