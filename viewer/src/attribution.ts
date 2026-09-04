/**
 * What changed between two scenes, as lines a reader can check against the room: what moved and how far,
 * what arrived, what left. Pure over the manifest's objects and floor placements, following the move chains
 * in identity.ts so a thing that changed id when it moved is one thing that moved.
 */
import type { Obj } from "./types";
import { rootOf } from "./identity";

/** Where an object stands on the floor, world metres. */
export type Placement = { id: number; x: number; z: number };
export type ChangeLine = { k: "move" | "add" | "rem"; id: number; metres: number | null; t: string };

const MOVE_MIN_M = 0.05; // registration slop; under this a thing did not move

export const centre = (o: Obj): Placement => ({ id: o.id, x: (o.bbox[0][0] + o.bbox[1][0]) / 2, z: (o.bbox[0][2] + o.bbox[1][2]) / 2 });
export const placementsOf = (objects: Obj[], commit: number): Placement[] => objects.filter((o) => o.present.includes(commit)).map(centre);
export const metres = (m: number) => `${m.toFixed(1)} m`;
const dist = (a: Placement, b: Placement) => Math.hypot(a.x - b.x, a.z - b.z);

/** Lines from scene A to scene B: moves first (largest first), then arrivals, then departures. */
export function attribution(objects: Obj[], A: Placement[], B: Placement[]): ChangeLine[] {
  const name = (id: number) => objects[id].name;
  const byRoot = (P: Placement[]) => new Map(P.map((p) => [rootOf(objects, p.id), p]));
  const ra = byRoot(A);
  const rb = byRoot(B);
  const moves: ChangeLine[] = [];
  const adds: ChangeLine[] = [];
  const rems: ChangeLine[] = [];
  for (const [root, pb] of rb) {
    const pa = ra.get(root);
    if (!pa) adds.push({ k: "add", id: pb.id, metres: null, t: `${name(pb.id)} arrives` });
    else {
      const d = dist(pa, pb);
      if (d > MOVE_MIN_M) moves.push({ k: "move", id: pb.id, metres: d, t: `${name(pb.id)} moved ${metres(d)}` });
    }
  }
  for (const [root, pa] of ra) if (!rb.has(root)) rems.push({ k: "rem", id: pa.id, metres: null, t: `${name(pa.id)} leaves` });
  moves.sort((x, y) => (y.metres ?? 0) - (x.metres ?? 0));
  return [...moves, ...adds, ...rems];
}

export const diffLines = (objects: Obj[], a: number, b: number) => attribution(objects, placementsOf(objects, a), placementsOf(objects, b));
