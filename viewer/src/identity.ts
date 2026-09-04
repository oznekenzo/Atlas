/**
 * One physical thing across the commits. The tracker gives a thing that moved a new id each time, linked by
 * moved_from / moved_to; everything the reader sees should follow the links, so the monstera is the monstera
 * in every commit, with one history. Pure over the manifest's object list.
 */
import type { Obj } from "./types";

export function rootOf(objects: Obj[], id: number): number {
  let o = objects[id];
  const seen = new Set<number>();
  while (o && o.moved_from !== null && !seen.has(o.id)) {
    seen.add(o.id);
    o = objects[o.moved_from];
  }
  return o ? o.id : id;
}

/** Every id of one thing, oldest first. */
export function chainOf(objects: Obj[], id: number): number[] {
  const chain = [rootOf(objects, id)];
  for (let o = objects[chain[0]]; o && o.moved_to !== null;) {
    const next = objects[o.moved_to];
    if (!next || chain.includes(next.id)) break;
    chain.push(next.id);
    o = next;
  }
  return chain;
}

export type Identity = {
  root: number;
  chain: number[];
  /** Commits the thing stands in, whichever id it wore. */
  present: number[];
  first: number;
  /** Commit it left for good, or null while it is still there at HEAD. */
  last: number | null;
  moves: { commit: number; from: number; to: number }[];
};

export function identityOf(objects: Obj[], id: number): Identity {
  const chain = chainOf(objects, id);
  const present = [...new Set(chain.flatMap((i) => objects[i].present))].sort((x, y) => x - y);
  const moves = chain.slice(1).map((to, k) => ({ commit: objects[to].added_in, from: chain[k], to }));
  return { root: chain[0], chain, present, first: objects[chain[0]].added_in, last: objects[chain[chain.length - 1]].removed_in, moves };
}

/** What changed between two commits, with a move reported as a move rather than a removal and an addition. */
export function changeSummary(objects: Obj[], a: number, b: number) {
  const added: number[] = [];
  const removed: number[] = [];
  for (const o of objects) {
    const inA = o.present.includes(a);
    const inB = o.present.includes(b);
    if (inB && !inA) added.push(o.id);
    if (inA && !inB) removed.push(o.id);
  }
  const moved: { from: number; to: number }[] = [];
  for (const r of [...removed]) {
    const to = added.find((x) => rootOf(objects, x) === rootOf(objects, r));
    if (to === undefined) continue;
    moved.push({ from: r, to });
    removed.splice(removed.indexOf(r), 1);
    added.splice(added.indexOf(to), 1);
  }
  return { added, removed, moved };
}
