/**
 * Application state. Plain data plus the actions that move it; the engine subscribes, React selects.
 * Every user-visible action is logged to `history` with a snapshot of the state *after* it, so the
 * log doubles as a reflog: any entry can be restored.
 */
import { create } from "zustand";
import type { Manifest } from "./types";
import { chainOf } from "./identity";
import type { Placement } from "./attribution";
import { measure, type Measure } from "./measure";

export type Mode = { kind: "normal" } | { kind: "diff"; a: number; b: number } | { kind: "onion" } | { kind: "proposal" };
export const NORMAL: Mode = { kind: "normal" };
export const sameMode = (x: Mode, y: Mode) => x.kind === y.kind && (x.kind !== "diff" || y.kind !== "diff" || (x.a === y.a && x.b === y.b));

export type Cam = { pos: [number, number, number]; target: [number, number, number] };
export type Snapshot = { head: number; mode: Mode; selected: number | null; cam: Cam | null };
export type Action = { id: number; t: number; verb: string; detail: string; snap: Snapshot };
export type Status = "loading" | "ready" | "error";
/**
 * A proposal: a branch off `base` that puts things back where they stood in `target`. Placements are floor
 * positions by the target commit's object id; a commit measures them. It is hypothetical until reality commits it.
 */
export type Proposal = {
  name: string;
  base: number;
  target: number;
  placements: Record<number, Placement>;
  commits: { n: number; msg: string; report: Measure }[];
};

/** Entries the reflog and HEAD@{n} count: everything except terminal bookkeeping. */
export const isNavigational = (a: Action) => a.verb !== "$" && a.verb !== "terminal";

let actionSeq = 0;
const T0 = performance.now();

export type State = {
  status: Status;
  error: string | null;
  manifest: Manifest | null;
  refScale: number; // ref units → metres
  history: Action[]; // full reflog, oldest first
  camera: Cam | null; // last recorded camera
  liveCamera: (() => Cam) | null; // engine-provided: the camera right now, so every snapshot is exact
  camRequest: { cam: Cam; seq: number } | null; // engine tweens to this when it changes
  head: number;
  mode: Mode;
  selected: number | null;
  hover: number | null; // object under the pointer; informational (cursor), never restyles the room
  loaded: boolean[]; // per commit
  loadErrors: Record<number, string>;
  splatCount: number[]; // per commit, once loaded
  terminalOpen: boolean;
  moving: boolean; // camera in motion → chrome fades
  proposal: Proposal | null; // the one branch; survives leaving it, so git checkout <name> returns to it
  placing: number | null; // the thing in hand, following the pointer along the floor
  intro: boolean; // the title card is up; the chrome waits until the user begins

  begin: () => void;
  branch: (name: string, target: number) => boolean;
  enterBranch: () => boolean;
  beginPlace: (id: number) => void;
  place: (id: number, x: number, z: number) => void;
  drop: () => void;
  unplace: (id: number) => void;
  commitProposal: (msg: string) => Measure | null;
  measureProposal: () => Measure | null;

  setManifest: (m: Manifest, refScale: number) => void;
  setStatus: (status: Status) => void;
  fail: (error: string) => void;
  markLoaded: (i: number, splats: number) => void;
  markFailed: (i: number, error: string) => void;
  log: (verb: string, detail?: string, snapOverride?: Partial<Snapshot>) => void;
  /** Replace the newest entry if it has this verb (a continuing gesture), else append. */
  amend: (verb: string, detail: string, snapOverride?: Partial<Snapshot>) => void;
  restore: (id: number) => boolean;
  setCamera: (cam: Cam) => void;
  checkout: (i: number) => boolean;
  diff: (a: number, b: number) => boolean;
  toggleOnion: () => void;
  select: (id: number | null) => void;
  setHover: (id: number | null) => void;
  setTerminal: (open: boolean) => void;
  setMoving: (m: boolean) => void;
};

/** One physical object across the commits (see identity.ts). */
export const traceChain = (m: Manifest, id: number): number[] => chainOf(m.objects, id);

/**
 * The selection after a checkout: the same thing under whichever id it wears in the commits now shown,
 * or nothing if it is not in any of them. A selection never outlives the object it points at.
 */
const carry = (m: Manifest, selected: number | null, shown: number[]): number | null => {
  if (selected === null) return null;
  for (const id of chainOf(m.objects, selected)) if (shown.some((c) => m.objects[id].present.includes(c))) return id;
  return null;
};

/** Objects that differ between two commits. Shared by the engine, the terminal, the legend and the log. */
export const objectsChanged = (m: Manifest, a: number, b: number) => {
  const added = new Set<number>();
  const removed = new Set<number>();
  for (const o of m.objects) {
    const inA = o.present.includes(a);
    const inB = o.present.includes(b);
    if (inB && !inA) added.add(o.id);
    if (inA && !inB) removed.add(o.id);
  }
  return { added, removed };
};

export const useStore = create<State>((set, get) => ({
  status: "loading",
  error: null,
  manifest: null,
  refScale: 1,
  history: [],
  camera: null,
  liveCamera: null,
  camRequest: null,
  head: 0,
  mode: NORMAL,
  selected: null,
  hover: null,
  loaded: [],
  loadErrors: {},
  splatCount: [],
  terminalOpen: false,
  moving: false,
  proposal: null,
  placing: null,
  intro: !new URLSearchParams(location.search).has("nointro"),

  // time runs forward: the set opens on its first commit, not on HEAD
  setManifest: (m, refScale) =>
    set({
      manifest: m,
      refScale,
      head: 0,
      loaded: m.commits.map(() => false),
      loadErrors: {},
      splatCount: m.commits.map(() => 0),
    }),
  setStatus: (status) => set({ status }),
  begin: () => {
    const st = get();
    const c = st.manifest?.commits[0];
    if (!st.intro || !c || !st.loaded[0]) return;
    st.log("begin", `c0  ${c.hash}`);
    set({ intro: false });
  },
  fail: (error) => set({ status: "error", error }),
  markLoaded: (i, splats) =>
    set((s) => {
      const loaded = [...s.loaded];
      loaded[i] = true;
      const splatCount = [...s.splatCount];
      splatCount[i] = splats;
      return { loaded, splatCount };
    }),
  markFailed: (i, error) => set((s) => ({ loadErrors: { ...s.loadErrors, [i]: error } })),

  // a snapshot describes the state AFTER the action; callers pass the parts that are about to change
  log: (verb, detail = "", snapOverride = {}) =>
    set((st) => {
      const snap: Snapshot = { head: st.head, mode: st.mode, selected: st.selected, cam: st.liveCamera?.() ?? st.camera, ...snapOverride };
      const a: Action = { id: ++actionSeq, t: performance.now() - T0, verb, detail, snap };
      return { history: [...st.history, a] };
    }),
  amend: (verb, detail, snapOverride = {}) => {
    const st = get();
    const last = st.history[st.history.length - 1];
    if (!last || last.verb !== verb) {
      st.log(verb, detail, snapOverride);
      return;
    }
    const a: Action = { ...last, t: performance.now() - T0, detail, snap: { ...last.snap, ...snapOverride } };
    set({ history: [...st.history.slice(0, -1), a] });
  },
  restore: (id) => {
    const st = get();
    const a = st.history.find((x) => x.id === id);
    if (!a || a === st.history[st.history.length - 1]) return false;
    const { head, selected, cam } = a.snap;
    const mode = a.snap.mode.kind === "proposal" && !st.proposal ? NORMAL : a.snap.mode; // a proposal that is gone cannot be restored
    if (!st.loaded[head]) return false;
    st.log("restore", `→ ${String(id).padStart(3, "0")}  ${a.verb}`, { head, mode, selected, cam });
    set({ head, mode, selected, camRequest: cam ? { cam, seq: id } : st.camRequest });
    return true;
  },
  setCamera: (camera) => set({ camera }),

  checkout: (i) => {
    const st = get();
    const c = st.manifest?.commits[i];
    if (!c || !st.loaded[i]) return false;
    const noop = st.mode.kind === "normal" && st.head === i;
    const selected = carry(st.manifest!, st.selected, [i]);
    st.log(noop ? "reset" : "checkout", `c${i}  ${c.hash}`, { head: i, mode: NORMAL, selected });
    set({ head: i, mode: NORMAL, selected, placing: null });
    return true;
  },
  // the proposal branch: things from the target carried onto the base's floor; a commit measures them
  branch: (name, target) => {
    const st = get();
    const M = st.manifest;
    const base = st.head;
    if (!M || !st.loaded[base] || !st.loaded[target] || target === base) return false;
    st.log("branch", `${name}  ← c${base}`, { mode: { kind: "proposal" }, selected: null });
    set({ proposal: { name, base, target, placements: {}, commits: [] }, mode: { kind: "proposal" }, selected: null, placing: null });
    return true;
  },
  enterBranch: () => {
    const st = get();
    const p = st.proposal;
    if (!p || !st.loaded[p.base]) return false;
    if (st.mode.kind === "proposal") return true;
    st.log("checkout", p.name, { head: p.base, mode: { kind: "proposal" }, selected: null });
    set({ head: p.base, mode: { kind: "proposal" }, selected: null, placing: null });
    return true;
  },
  beginPlace: (id) => {
    const st = get();
    if (st.mode.kind !== "proposal" || !st.proposal) return;
    set({ placing: id, selected: null });
  },
  place: (id, x, z) => set((s) => (s.proposal ? { proposal: { ...s.proposal, placements: { ...s.proposal.placements, [id]: { id, x, z } } } } : {})),
  drop: () => {
    const st = get();
    const id = st.placing;
    if (id === null || !st.proposal) return;
    const p = st.proposal.placements[id];
    if (p) st.log("place", `${st.manifest?.objects[id].name ?? id}  → ${p.x.toFixed(2)} ${p.z.toFixed(2)}`);
    set({ placing: null });
  },
  unplace: (id) => {
    const st = get();
    if (!st.proposal) return;
    const placements = { ...st.proposal.placements };
    const had = id in placements;
    delete placements[id];
    if (had) st.log("unplace", st.manifest?.objects[id].name ?? String(id));
    set({ proposal: { ...st.proposal, placements }, placing: null });
  },
  measureProposal: () => {
    const st = get();
    const M = st.manifest;
    const p = st.proposal;
    if (!M || !p) return null;
    return measure(M.objects, p.base, p.target, p.placements, `c${p.target}`);
  },
  commitProposal: (msg) => {
    const st = get();
    const p = st.proposal;
    if (!p || st.mode.kind !== "proposal") return null;
    const report = st.measureProposal()!;
    const n = p.commits.length + 1;
    const mean = report.meanM === null ? "nothing placed" : `mean ${report.meanM.toFixed(2)} m`;
    st.log("commit", `${p.name}  ${report.placed}/${report.ofN} placed · ${mean}`);
    set({ proposal: { ...p, commits: [...p.commits, { n, msg, report }] }, placing: null });
    return report;
  },
  diff: (a, b) => {
    const st = get();
    if (!st.manifest || a === b || !st.loaded[a] || !st.loaded[b]) return false;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const mode: Mode = { kind: "diff", a: lo, b: hi };
    const { added, removed } = objectsChanged(st.manifest, lo, hi);
    const selected = carry(st.manifest, st.selected, [lo, hi]);
    st.log("diff", `c${lo}…c${hi}  +${added.size} −${removed.size}`, { head: hi, mode, selected });
    set({ head: hi, mode, selected });
    return true;
  },
  toggleOnion: () => {
    const st = get();
    const on = st.mode.kind !== "onion";
    const mode: Mode = on ? { kind: "onion" } : NORMAL;
    st.log("onion", on ? `${st.loaded.filter(Boolean).length} layers` : "off", { mode });
    set({ mode });
  },
  select: (id) => {
    const st = get();
    if (id === st.selected) return;
    const o = id === null ? null : st.manifest?.objects[id];
    if (id !== null && !o) return;
    if (o) st.log("select", o.name, { selected: id });
    else st.log("deselect", "", { selected: null });
    set({ selected: id });
  },
  setHover: (id) => set((s) => (s.hover === id ? {} : { hover: id })),
  setTerminal: (open) => {
    const st = get();
    if (open === st.terminalOpen) return;
    st.log("terminal", open ? "open" : "close");
    set({ terminalOpen: open });
  },
  setMoving: (moving) => set((s) => (s.moving === moving ? {} : { moving })),
}));
