import * as THREE from "three";
import type { Manifest } from "./types";

/** Load a gzipped uint16 voxel grid (object id + 1 per voxel; 0 = static). */
export async function loadLabels(url: string, shape: number[], signal?: AbortSignal): Promise<Uint16Array> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  let buf = await res.arrayBuffer();
  // Served either raw-gzip (we inflate) or transparently inflated by the host (Content-Encoding). Sniff the magic.
  const b = new Uint8Array(buf);
  if (b[0] === 0x1f && b[1] === 0x8b) {
    buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  }
  const n = shape[0] * shape[1] * shape[2];
  if (buf.byteLength !== n * 2) throw new Error(`${url}: ${buf.byteLength} bytes, expected ${n * 2}`);
  return new Uint16Array(buf);
}

/** world_from_ref as a three.js matrix (the manifest stores the top 3 rows). */
export function worldFromRef(m: Manifest): THREE.Matrix4 {
  const r = m.world_from_ref;
  return new THREE.Matrix4().set(
    r[0][0],
    r[0][1],
    r[0][2],
    r[0][3],
    r[1][0],
    r[1][1],
    r[1][2],
    r[1][3],
    r[2][0],
    r[2][1],
    r[2][2],
    r[2][3],
    0,
    0,
    0,
    1,
  );
}

/** Ref units → metres: the uniform scale folded into world_from_ref. */
export const refScaleOf = (m: Manifest) => Math.cbrt(Math.abs(new THREE.Matrix3().setFromMatrix4(worldFromRef(m)).determinant()));

/** Map a world-space point to the voxel grid index, or -1 if outside. Grid is C-order (i,j,k). */
export function makeVoxelLookup(m: Manifest) {
  const refFromWorld = worldFromRef(m).invert();
  const [sx, sy, sz] = m.shape;
  const [ox, oy, oz] = m.origin;
  const v = m.voxel;
  const p = new THREE.Vector3();
  return (x: number, y: number, z: number): number => {
    p.set(x, y, z).applyMatrix4(refFromWorld);
    const i = Math.floor((p.x - ox) / v);
    const j = Math.floor((p.y - oy) / v);
    const k = Math.floor((p.z - oz) / v);
    if (i < 0 || j < 0 || k < 0 || i >= sx || j >= sy || k >= sz) return -1;
    return (i * sy + j) * sz + k;
  };
}

/** Axis-aligned ref-frame box → world-space Box3 (re-fit after the rotation). */
export function worldBox(m: Manifest, bbox: [number[], number[]]): THREE.Box3 {
  const W = worldFromRef(m);
  const box = new THREE.Box3();
  const [a, b] = bbox;
  for (const x of [a[0], b[0]])
    for (const y of [a[1], b[1]])
      for (const z of [a[2], b[2]]) {
        box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(W));
      }
  return box;
}

/** The room in world space. Drives camera framing and orbit limits. Falls back to the (padded) voxel grid extent. */
export const roomBox = (m: Manifest) =>
  m.room
    ? new THREE.Box3(new THREE.Vector3(...(m.room[0] as [number, number, number])), new THREE.Vector3(...(m.room[1] as [number, number, number])))
    : worldBox(m, [m.origin, m.origin.map((o, i) => o + m.shape[i] * m.voxel)]);
