import { create } from "zustand";
import type { Manifest } from "./types";

export type Mode = { kind: "normal" } | { kind: "diff"; a: number; b: number } | { kind: "onion" };

export type State = {
  manifest: Manifest | null;
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

export const useStore = create<State>((set, get) => ({
  manifest: null, head: 0, mode: { kind: "normal" }, selected: null, hover: null,
  loaded: [], splatCount: [], terminalOpen: false, moving: false, diffStats: null, refScale: 1,

  setManifest: (m, refScale) => set({ manifest: m, refScale, head: m.commits.length - 1,
    loaded: m.commits.map(() => false), splatCount: m.commits.map(() => 0) }),
  markLoaded: (i, splats) => set(s => { const loaded = [...s.loaded]; loaded[i] = true; const sc = [...s.splatCount]; sc[i] = splats; return { loaded, splatCount: sc }; }),
  checkout: (i) => { if (!get().loaded[i]) return; set({ head: i, mode: { kind: "normal" } }); },
  diff: (a, b) => { const { loaded } = get(); if (a === b || !loaded[a] || !loaded[b]) return; const lo = Math.min(a, b), hi = Math.max(a, b); set({ head: hi, mode: { kind: "diff", a: lo, b: hi } }); },
  toggleOnion: () => set(s => ({ mode: s.mode.kind === "onion" ? { kind: "normal" } : { kind: "onion" } })),
  select: (id) => set({ selected: id }),
  setHover: (id) => set(s => (s.hover === id ? {} : { hover: id })),
  setTerminal: (open) => set({ terminalOpen: open }),
  setMoving: (moving) => set({ moving }),
  setDiffStats: (diffStats) => set({ diffStats }),
}));

/** Selectors that the engine and components share. */
export const objectsChanged = (m: Manifest, a: number, b: number) => {
  const added = new Set<number>(), removed = new Set<number>();
  for (const o of m.objects) { const inA = o.present.includes(a), inB = o.present.includes(b); if (inB && !inA) added.add(o.id); if (inA && !inB) removed.add(o.id); }
  return { added, removed };
};
