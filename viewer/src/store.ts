/**
 * Application state. Plain data plus the actions that move it; the engine subscribes, React selects.
 * Every user-visible action is logged to `history` with a snapshot of the state *after* it, so the
 * log doubles as a reflog: any entry can be restored.
 */
import { create } from "zustand";
import type { Manifest } from "./types";

export type Mode = { kind: "normal" } | { kind: "diff"; a: number; b: number } | { kind: "onion" };
export const NORMAL: Mode = { kind: "normal" };
export const sameMode = (x: Mode, y: Mode) => x.kind === y.kind && (x.kind !== "diff" || y.kind !== "diff" || (x.a === y.a && x.b === y.b));

export type Cam = { pos: [number, number, number]; target: [number, number, number] };
export type Snapshot = { head: number; mode: Mode; selected: number | null; cam: Cam | null };
export type Action = { id: number; t: number; verb: string; detail: string; snap: Snapshot };
export type Status = "loading" | "ready" | "error";

/** Entries the reflog and HEAD@{n} count: everything except terminal bookkeeping. */
export const isNavigational = (a: Action) => a.verb !== "$" && a.verb !== "terminal";

let actionSeq = 0;
const T0 = performance.now();
const pad2 = (n: number) => String(n).padStart(2, "0");

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
  hover: number | null;
  loaded: boolean[]; // per commit
  loadErrors: Record<number, string>;
  splatCount: number[]; // per commit, once loaded
  terminalOpen: boolean;
  boxes: boolean; // detection overlay
  moving: boolean; // camera in motion → chrome fades

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
  toggleBoxes: () => void;
  setMoving: (m: boolean) => void;
};

/**
 * One physical object across the commits: the tracker splits a thing that moved into separate ids
 * linked by moved_from / moved_to, so following the links is what makes a trace a trail.
 */
export const traceChain = (m: Manifest, id: number): number[] => {
  const chain = [id];
  for (let o = m.objects[id]; o?.moved_from != null;) {
    const prev = m.objects[o.moved_from];
    if (!prev || chain.includes(prev.id)) break;
    chain.unshift(prev.id);
    o = prev;
  }
  for (let o = m.objects[id]; o?.moved_to != null;) {
    const next = m.objects[o.moved_to];
    if (!next || chain.includes(next.id)) break;
    chain.push(next.id);
    o = next;
  }
  return chain;
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
  boxes: false,
  moving: false,

  setManifest: (m, refScale) =>
    set({
      manifest: m,
      refScale,
      head: m.commits.length - 1,
      loaded: m.commits.map(() => false),
      loadErrors: {},
      splatCount: m.commits.map(() => 0),
    }),
  setStatus: (status) => set({ status }),
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
    const { head, mode, selected, cam } = a.snap;
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
    st.log(noop ? "reset" : "checkout", `c${i}  ${c.hash}`, { head: i, mode: NORMAL });
    set({ head: i, mode: NORMAL });
    return true;
  },
  diff: (a, b) => {
    const st = get();
    if (!st.manifest || a === b || !st.loaded[a] || !st.loaded[b]) return false;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const mode: Mode = { kind: "diff", a: lo, b: hi };
    const { added, removed } = objectsChanged(st.manifest, lo, hi);
    st.log("diff", `c${lo}…c${hi}  +${added.size} −${removed.size}`, { head: hi, mode });
    set({ head: hi, mode });
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
    if (o) st.log("select", `obj ${pad2(o.id)}  ${o.name}`, { selected: id });
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
  toggleBoxes: () => {
    const st = get();
    const boxes = !st.boxes;
    st.log("boxes", boxes ? "on" : "off");
    set({ boxes });
  },
  setMoving: (moving) => set((s) => (s.moving === moving ? {} : { moving })),
}));
