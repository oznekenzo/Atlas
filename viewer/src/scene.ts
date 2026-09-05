/**
 * The scene model: what is in the room and how each thing stands. The one place that decides what a thing is
 * across states (the chain of ids it wears as it moves), where it stands (its centre on the floor), what changed
 * between two states, and how a state compares with the standard. Pure over the manifest's objects; the engine,
 * the panels, the card, the month block and the map read it, and none of them re-derive it.
 *
 * One definition of a move, used everywhere: the same thing (by chain) standing more than MOVE_MIN_M from where it
 * stood, whether the tracker gave it a new id or not.
 */
import type { Obj } from "./types";

export const MOVE_MIN_M = 0.05; // registration slop; under this a thing did not move

export type Placement = { x: number; z: number };
export const centre = (o: Obj): Placement => ({ x: (o.bbox[0][0] + o.bbox[1][0]) / 2, z: (o.bbox[0][2] + o.bbox[1][2]) / 2 });
export const distance = (a: Placement, b: Placement) => Math.hypot(a.x - b.x, a.z - b.z);
export const metres = (m: number) => `${m.toFixed(1)} m`;

// ---- a thing: one physical object across the states ----------------------------------------------------------

/** The first id a thing wore: follow moved_from back to the start. Cycles and dangling links stop the walk. */
export function rootOf(objects: Obj[], id: number): number {
  const seen = new Set<number>();
  let cur = id;
  while (!seen.has(cur)) {
    seen.add(cur);
    const prev = objects[cur]?.moved_from;
    if (prev === null || prev === undefined || !objects[prev]) return cur;
    cur = prev;
  }
  return cur;
}

/** Every id a thing wears, oldest first: its root, then each id it moved to. */
export function chainOf(objects: Obj[], id: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  let cur: number | null = rootOf(objects, id);
  while (cur !== null && !seen.has(cur) && objects[cur]) {
    seen.add(cur);
    out.push(cur);
    cur = objects[cur].moved_to;
  }
  return out;
}

export type Thing = { root: number; name: string; ids: number[] };
export const thingOf = (objects: Obj[], id: number): Thing => {
  const ids = chainOf(objects, id);
  return { root: ids[0], name: objects[ids[0]].name, ids };
};
/** Every thing, one per chain, in the order their roots were found. */
export const things = (objects: Obj[]): Thing[] => objects.filter((o) => rootOf(objects, o.id) === o.id).map((o) => thingOf(objects, o.id));
/** The id a thing wears in a state, following its chain, or null if it is not there. */
export const idAt = (objects: Obj[], id: number, state: number): number | null =>
  chainOf(objects, id).find((i) => objects[i].present.includes(state)) ?? null;
/** The selection to keep when the shown states change: the same thing under its id there, or nothing. */
export const carry = (objects: Obj[], selected: number | null, shown: number[]): number | null => {
  if (selected === null) return null;
  for (const id of chainOf(objects, selected)) if (shown.some((c) => objects[id].present.includes(c))) return id;
  return null;
};

// ---- a diff: how a thing changed from state a to state b -----------------------------------------------------

export type Change =
  | { k: "same"; id: number; name: string } // in both, where it was (id as worn in b)
  | { k: "moved"; id: number; from: number; metres: number; name: string } // in both, elsewhere: id in b, from in a
  | { k: "added"; id: number; name: string } // in b only
  | { k: "removed"; id: number; name: string }; // in a only (id as worn in a)
export type Diff = {
  a: number;
  b: number;
  changes: Change[];
  added: Set<number>; // b-side ids
  removed: Set<number>; // a-side ids
  movedTo: Map<number, number>; // b-side id → a-side id, for the arrow back to where it was
  movedFrom: Map<number, number>; // a-side id → b-side id
};

export function diff(objects: Obj[], a: number, b: number): Diff {
  const changes: Change[] = [];
  const added = new Set<number>();
  const removed = new Set<number>();
  const movedTo = new Map<number, number>();
  const movedFrom = new Map<number, number>();
  for (const t of things(objects)) {
    const ia = t.ids.find((i) => objects[i].present.includes(a)) ?? null;
    const ib = t.ids.find((i) => objects[i].present.includes(b)) ?? null;
    if (ia === null && ib === null) continue;
    if (ia === null) {
      added.add(ib!);
      changes.push({ k: "added", id: ib!, name: t.name });
    } else if (ib === null) {
      removed.add(ia);
      changes.push({ k: "removed", id: ia, name: t.name });
    } else {
      const d = distance(centre(objects[ia]), centre(objects[ib]));
      if (d > MOVE_MIN_M) {
        movedTo.set(ib, ia);
        movedFrom.set(ia, ib);
        changes.push({ k: "moved", id: ib, from: ia, metres: d, name: t.name });
      } else changes.push({ k: "same", id: ib, name: t.name });
    }
  }
  return { a, b, changes, added, removed, movedTo, movedFrom };
}

// ---- drift: how a state stands against the standard ----------------------------------------------------------

export type DriftLine =
  | { k: "keep"; id: number; name: string } // where the standard has it
  | { k: "move"; id: number; stdId: number; metres: number; from: Placement; name: string } // must move back: id at head, stdId in the standard
  | { k: "remove"; id: number; name: string } // at head, not in the standard
  | { k: "add"; stdId: number; from: Placement; name: string }; // in the standard, missing at head
export type Drift = { isStandard: boolean; lines: DriftLine[]; off: number; missing: number; extra: number; meanM: number | null };

/** The standard read as the earlier state of a diff: what the head must do to match it. */
export function drift(objects: Obj[], standard: number, head: number): Drift {
  if (standard === head) return { isStandard: true, lines: [], off: 0, missing: 0, extra: 0, meanM: null };
  const d = diff(objects, standard, head);
  const lines: DriftLine[] = [];
  let sum = 0;
  for (const c of d.changes) {
    if (c.k === "same") lines.push({ k: "keep", id: c.id, name: c.name });
    else if (c.k === "moved") {
      lines.push({ k: "move", id: c.id, stdId: c.from, metres: c.metres, from: centre(objects[c.from]), name: c.name });
      sum += c.metres;
    } else if (c.k === "added") lines.push({ k: "remove", id: c.id, name: c.name });
    else lines.push({ k: "add", stdId: c.id, from: centre(objects[c.id]), name: c.name });
  }
  const order = { keep: 0, move: 1, remove: 2, add: 3 };
  lines.sort((x, y) => order[x.k] - order[y.k]);
  const off = lines.filter((l) => l.k === "move").length;
  return {
    isStandard: false,
    lines,
    off,
    missing: lines.filter((l) => l.k === "add").length,
    extra: lines.filter((l) => l.k === "remove").length,
    meanM: off ? sum / off : null,
  };
}

/** The month's status against the standard, as the design words it. */
export type Status = { text: string; cls: "std" | "off" | "on" | "before" | "none" };
export function status(objects: Obj[], head: number, standard: number | null): Status {
  if (standard === null) return { text: "—", cls: "none" };
  if (head === standard) return { text: "Standard", cls: "std" };
  if (head < standard) return { text: "Before standard", cls: "before" };
  const d = drift(objects, standard, head);
  return d.off + d.missing > 0 ? { text: "Off standard", cls: "off" } : { text: "On standard", cls: "on" };
}

/** One thing's standing at head against the standard, for its card. */
export type Standing = { k: "match" | "off" | "missing" | "extra" | "none"; metres: number | null; t: string };
export function standing(objects: Obj[], id: number, head: number, standard: number | null): Standing {
  if (standard === null) return { k: "none", metres: null, t: "" };
  const t = thingOf(objects, id);
  const atStd = t.ids.find((i) => objects[i].present.includes(standard)) ?? null;
  const atHead = t.ids.find((i) => objects[i].present.includes(head)) ?? null;
  if (atStd === null) return { k: "extra", metres: null, t: "Not in the standard" };
  if (atHead === null) return { k: "missing", metres: null, t: "Missing from this state" };
  const m = distance(centre(objects[atStd]), centre(objects[atHead]));
  return m > MOVE_MIN_M ? { k: "off", metres: m, t: `${metres(m)} from the standard` } : { k: "match", metres: null, t: "Where the standard has it" };
}

// ---- months: one thing through time, for its card ------------------------------------------------------------

export type MonthRow = { state: number; id: number | null; mark: "arrived" | "moved" | "in room" | "not in room"; metres: number | null };
export function months(objects: Obj[], nStates: number, id: number): MonthRow[] {
  const t = thingOf(objects, id);
  const at = (s: number) => t.ids.find((i) => objects[i].present.includes(s)) ?? null;
  const first = Math.min(...t.ids.map((i) => objects[i].added_in));
  const rows: MonthRow[] = [];
  for (let s = 0; s < nStates; s++) {
    const cur = at(s);
    const prev = s > 0 ? at(s - 1) : null;
    if (cur === null) rows.push({ state: s, id: null, mark: "not in room", metres: null });
    else if (prev !== null) {
      const m = distance(centre(objects[prev]), centre(objects[cur]));
      rows.push(m > MOVE_MIN_M ? { state: s, id: cur, mark: "moved", metres: m } : { state: s, id: cur, mark: "in room", metres: null });
    } else rows.push({ state: s, id: cur, mark: s === first ? "arrived" : "in room", metres: null });
  }
  return rows;
}
