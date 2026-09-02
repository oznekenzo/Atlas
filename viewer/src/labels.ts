import * as THREE from "three";
import type { Manifest } from "./types";

/** Load a gzipped uint16 voxel grid (object id + 1 per voxel; 0 = static). */
export async function loadLabels(url: string, shape: number[]): Promise<Uint16Array> {
  // Served either raw-gzip (we inflate) or transparently inflated by the host (Content-Encoding). Sniff the magic.
  let buf = await (await fetch(url)).arrayBuffer();
  const b = new Uint8Array(buf);
  if (b[0] === 0x1f && b[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const n = shape[0] * shape[1] * shape[2];
  if (buf.byteLength !== n * 2) throw new Error(`label grid ${url}: ${buf.byteLength} bytes, expected ${n * 2}`);
  return new Uint16Array(buf);
}

/** Map a world-space point to the voxel grid index, or -1 if outside. Grid is C-order (i,j,k). */
export function makeVoxelLookup(m: Manifest) {
  const W = new THREE.Matrix4().set(
    m.world_from_ref[0][0], m.world_from_ref[0][1], m.world_from_ref[0][2], m.world_from_ref[0][3],
    m.world_from_ref[1][0], m.world_from_ref[1][1], m.world_from_ref[1][2], m.world_from_ref[1][3],
    m.world_from_ref[2][0], m.world_from_ref[2][1], m.world_from_ref[2][2], m.world_from_ref[2][3],
    0, 0, 0, 1);
  const refFromWorld = W.clone().invert();
  const [sx, sy, sz] = m.shape; const [ox, oy, oz] = m.origin; const v = m.voxel;
  const p = new THREE.Vector3();
  return (x: number, y: number, z: number): number => {
    p.set(x, y, z).applyMatrix4(refFromWorld);
    const i = Math.floor((p.x - ox) / v), j = Math.floor((p.y - oy) / v), k = Math.floor((p.z - oz) / v);
    if (i < 0 || j < 0 || k < 0 || i >= sx || j >= sy || k >= sz) return -1;
    return (i * sy + j) * sz + k;
  };
}

/** Object bbox (ref frame, axis-aligned) -> world-space Box3 (re-fit after the rotation). */
export function worldBox(m: Manifest, bbox: [number[], number[]]): THREE.Box3 {
  const W = new THREE.Matrix4().set(
    m.world_from_ref[0][0], m.world_from_ref[0][1], m.world_from_ref[0][2], m.world_from_ref[0][3],
    m.world_from_ref[1][0], m.world_from_ref[1][1], m.world_from_ref[1][2], m.world_from_ref[1][3],
    m.world_from_ref[2][0], m.world_from_ref[2][1], m.world_from_ref[2][2], m.world_from_ref[2][3],
    0, 0, 0, 1);
  const box = new THREE.Box3();
  const [a, b] = bbox;
  for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]])
    box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(W));
  return box;
}
