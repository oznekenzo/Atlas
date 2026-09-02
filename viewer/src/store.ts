import { create } from "zustand";
import type { Manifest } from "./types";

export type Mode = { kind: "normal" } | { kind: "diff"; a: number; b: number } | { kind: "onion" };

export type Cam = { pos: [number, number, number]; target: [number, number, number] };
export type Snapshot = { head: number; mode: Mode; selected: number | null; cam: Cam | null };
export type Action = { id: number; t: number; verb: string; detail: string; snap: Snapshot };
let actionSeq = 0; const T0 = performance.now();

export type State = {
  manifest: Manifest | null;
  actions: Action[];                 // newest first, capped (the visible log)
  history: Action[];                 // full reflog, oldest first
  camera: Cam | null;                // last recorded camera
  liveCamera: (() => Cam) | null;    // engine-provided: the camera right now, so every snapshot is exact
  camRequest: { cam: Cam; seq: number } | null;   // engine tweens to this when it changes
  log: (verb: string, detail?: string, snapOverride?: Partial<Snapshot>) => void;
  /** Replace the newest entry if it has this verb (a continuing gesture), else append. */
  amend: (verb: string, detail: string, snapOverride?: Partial<Snapshot>) => void;
  restore: (id: number) => void;
  setCamera: (cam: Cam) => void;
  head: number;
  mode: Mode;
  selected: number | null;
  hover: number | null;
  loaded: boolean[];                 // per commit
  splatCount: number[];              // per commit, once loaded
  terminalOpen: boolean;
  moving: boolean;                   // camera in motion -> chrome fades
  diffStats: { added: number; removed: number; volumeM3: number } | null;
  refScale: number;                  // ref units -> metres

  setManifest: (m: Manifest, refScale: number) => void;
  markLoaded: (i: number, splats: number) => void;
  checkout: (i: number) => void;
  diff: (a: number, b: number) => void;
  toggleOnion: () => void;
  select: (id: number | null) => void;
  setHover: (id: number | null) => void;
  setTerminal: (open: boolean) => void;
  setMoving: (m: boolean) => void;
  setDiffStats: (s: State["diffStats"]) => void;
};

/** Objects that differ between two commits. Shared by the engine, the terminal and the action log. */
export const objectsChanged = (m: Manifest, a: number, b: number) => {
  const added = new Set<number>(), removed = new Set<number>();
  for (const o of m.objects) { const inA = o.present.includes(a), inB = o.present.includes(b); if (inB && !inA) added.add(o.id); if (inA && !inB) removed.add(o.id); }
  return { added, removed };
};

export const useStore = create<State>((set, get) => ({
  manifest: null, actions: [], history: [], camera: null, liveCamera: null, camRequest: null, head: 0, mode: { kind: "normal" }, selected: null, hover: null,
  // a snapshot describes the state AFTER the action; callers pass the parts that are about to change
  log: (verb, detail = "", snapOverride = {}) => set(st => {
    const snap: Snapshot = { head: st.head, mode: st.mode, selected: st.selected, cam: st.liveCamera?.() ?? st.camera, ...snapOverride };
    const a: Action = { id: ++actionSeq, t: performance.now() - T0, verb, detail, snap };
    return { actions: [a, ...st.actions].slice(0, 8), history: [...st.history, a] }; }),
  amend: (verb, detail, snapOverride = {}) => { const st = get(); const last = st.history[st.history.length - 1];
    if (!last || last.verb !== verb) { st.log(verb, detail, snapOverride); return; }
    const snap: Snapshot = { ...last.snap, ...snapOverride }; const a: Action = { ...last, t: performance.now() - T0, detail, snap };
    set({ history: [...st.history.slice(0, -1), a], actions: st.actions.map(x => (x.id === a.id ? a : x)) }); },
  restore: (id) => { const st = get(); const a = st.history.find(x => x.id === id); if (!a || a === st.history[st.history.length - 1]) return;
    const { head, mode, selected, cam } = a.snap; if (!st.loaded[head]) return;
    st.log("restore", `→ ${String(id).padStart(3, "0")}  ${a.verb}`, { head, mode, selected, cam });
    set({ head, mode, selected, camRequest: cam ? { cam, seq: id } : st.camRequest }); },
  setCamera: (camera) => set({ camera }),
  loaded: [], splatCount: [], terminalOpen: false, moving: false, diffStats: null, refScale: 1,

  setManifest: (m, refScale) => set({ manifest: m, refScale, head: m.commits.length - 1,
    loaded: m.commits.map(() => false), splatCount: m.commits.map(() => 0) }),
  markLoaded: (i, splats) => set(s => { const loaded = [...s.loaded]; loaded[i] = true; const sc = [...s.splatCount]; sc[i] = splats; return { loaded, splatCount: sc }; }),
  checkout: (i) => { const st = get(); if (!st.loaded[i]) return; const c = st.manifest!.commits[i];
    st.log(st.mode.kind === "normal" && st.head === i ? "reset" : "checkout", `c${i}  ${c.hash}`, { head: i, mode: { kind: "normal" } }); set({ head: i, mode: { kind: "normal" } }); },
  diff: (a, b) => { const st = get(); if (a === b || !st.loaded[a] || !st.loaded[b]) return; const lo = Math.min(a, b), hi = Math.max(a, b);
    const { added, removed } = objectsChanged(st.manifest!, lo, hi); st.log("diff", `c${lo}…c${hi}  +${added.size} −${removed.size}`, { head: hi, mode: { kind: "diff", a: lo, b: hi } }); set({ head: hi, mode: { kind: "diff", a: lo, b: hi } }); },
  toggleOnion: () => { const st = get(); const on = st.mode.kind !== "onion"; const mode: Mode = on ? { kind: "onion" } : { kind: "normal" }; st.log("onion", on ? `${st.loaded.filter(Boolean).length} layers` : "off", { mode }); set({ mode }); },
  select: (id) => { const st = get(); if (id === st.selected) return; if (id === null) st.log("deselect", "", { selected: null }); else { const o = st.manifest!.objects[id]; st.log("select", `obj ${String(id).padStart(2, "0")}  ${o.name}`, { selected: id }); } set({ selected: id }); },
  setHover: (id) => set(s => (s.hover === id ? {} : { hover: id })),
  setTerminal: (open) => { const st = get(); if (open !== st.terminalOpen) st.log("terminal", open ? "open" : "close"); set({ terminalOpen: open }); },
  setMoving: (moving) => set({ moving }),
  setDiffStats: (diffStats) => set({ diffStats }),
}));

