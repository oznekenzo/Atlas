/**
 * Application state. Plain data plus the actions that move it; the engine subscribes, React selects.
 * Every user-visible action is logged to `history` with a snapshot of the state *after* it, so the
 * log doubles as a reflog: any entry can be restored.
 *
 * The room has three renderings (a state, a diff between two states, a draft on the empty floor), one
 * overlay (the standard's ghosts), and around them the demo's script: the title deck, the checklist, the tour.
 */
import { create } from "zustand";
import type { Manifest, Site } from "./types";
import { carry } from "./scene";
import {
  canSave as canSaveDraft,
  clearAllDrafts,
  draftDirty,
  fitDrafts,
  nameOf as draftName,
  proposalOf,
  readDrafts,
  savedOf,
  seedOf,
  type Proposal,
  type SavedDraft,
} from "./drafts";
import { GOALS, LANDING, PRESETS, SLIDES, TOUR } from "./demo";
import { dateOf, monthOf } from "./time";

export type Mode = { kind: "normal" } | { kind: "compare"; a: number; b: number; headBefore: number } | { kind: "draft" };
export const NORMAL: Mode = { kind: "normal" };
export const DEFAULT_SET = "garage"; // the set the viewer opens first: the demo's floor
export type Page = "title" | "room" | "footnotes";

export type Cam = { pos: [number, number, number]; target: [number, number, number] };
/** A thing put down on the draft's floor. `key` tells copies of the same object apart. */
export type Placed = { key: number; id: number; x: number; z: number };
/** The thing in hand: following the pointer once `at` is true, nowhere yet before that. */
export type InHand = Placed & { at: boolean };
/**
 * A draft: a layout tried on the empty floor. From scratch it starts bare; from a state it starts as that
 * state's things, each a placement that can be picked up and moved. Measure records how many things are down.
 * Saved, it is a branch: `id` names its entry in `drafts`; null until the first save.
 */
export type Draft = { id: number | null; base: number | null; placements: Placed[]; inHand: InHand | null; attempts: { n: number; text: string }[] };
export type Snapshot = {
  head: number;
  mode: Mode;
  selected: number | null;
  ghosts: boolean;
  standard: number | null;
  draft: Draft | null;
  cam: Cam | null;
};
export type Action = { id: number; t: number; verb: string; detail: string; snap: Snapshot };
export type Status = "loading" | "ready" | "error";

const MAX_COPIES = 4; // of one object in a draft: each copy is its own mesh
const GUIDE_KEY = "atlas.guide";

let actionSeq = 0;
let placedSeq = 0;
let orbited = false; // the arrival's slow orbit runs once per page load
const T0 = performance.now();

export type State = {
  status: Status;
  error: string | null;
  set: string; // the set the room shows: a directory under sets/. The engine opens whatever this becomes
  sites: Site[]; // the picker: every floor, from the first manifest that carried the list
  manifest: Manifest | null;
  refScale: number; // ref units → metres
  history: Action[]; // full reflog, oldest first
  camera: Cam | null; // last recorded camera
  liveCamera: (() => Cam) | null; // engine-provided: the camera right now, so every snapshot is exact
  camRequest: { cam: Cam; seq: number } | null; // engine tweens to this when it changes

  page: Page;
  returnTo: Page;
  slide: number; // the deck: 0 is the title, 1…SLIDES.length the slides
  leaving: boolean; // the deck is fading to black on its way into the room
  curtain: boolean; // the room is under black, about to fade up
  preset: string | null; // the ?s= start state, if any

  head: number;
  mode: Mode;
  selected: number | null;
  hover: number | null; // object under the pointer; informational (cursor), never restyles the room
  loaded: boolean[]; // per commit
  loadErrors: Record<number, string>;
  splatCount: number[]; // per commit, once loaded
  moving: boolean; // camera in motion → chrome fades
  orbit: boolean; // the arrival's slow orbit: the camera drifting around the room until the first press or scroll on the scene
  standard: number | null; // the state tagged as the approved layout
  ghosts: boolean; // compare to standard: the standard's ghosts drawn in this state
  draft: Draft | null;
  drafts: SavedDraft[]; // the branches: saved drafts, per set, kept in the browser. Not in the snapshot: a restore never undeletes
  draftSeq: number; // the last branch number minted; only grows, so a name is never reused

  site: string;
  sitesOpen: boolean;
  menuOpen: boolean; // the ATLAS menu, top right
  confirmStd: boolean; // the dialog before a state becomes the standard
  goals: Record<string, boolean>;
  tour: number; // -1 = off, else the step
  openGoal: string | null;
  hints: boolean;

  // the deck
  nextSlide: () => void;
  prevSlide: () => void;
  leave: () => void;
  arrive: () => void;
  liftCurtain: () => void;
  restartDemo: () => void;
  // the room
  go: (i: number) => boolean;
  step: (d: number) => void;
  toggleCompare: () => void;
  exitMode: () => void;
  toggleGhosts: () => void;
  makeStandard: () => void;
  select: (id: number | null) => void;
  esc: () => void;
  endOrbit: () => void;
  // a draft
  enterDraft: () => void;
  setDraftBase: (base: number | null) => void;
  pickFromTray: (id: number) => void;
  pickUpPlaced: (key: number) => void;
  moveInHand: (x: number, z: number) => void;
  placeAt: (x: number, z: number) => void;
  dropInHand: () => void;
  measure: () => void;
  leaveDraft: () => void;
  saveDraft: () => void;
  openDraft: (id: number) => boolean;
  deleteDraft: (id: number) => void;
  // the chrome
  toggleSites: () => void;
  closeSites: () => void;
  toggleMenu: () => void;
  closeMenus: () => void;
  askStandard: () => void;
  cancelStandard: () => void;
  confirmStandard: () => void;
  pickSite: (id: string) => void;
  openFoot: () => void;
  back: () => void;
  tourNext: () => void;
  tourSkip: () => void;
  toggleGoal: (id: string) => void;
  // bookkeeping
  setManifest: (m: Manifest, refScale: number) => void;
  setStatus: (status: Status) => void;
  fail: (error: string) => void;
  markLoaded: (i: number, splats: number) => void;
  markFailed: (i: number, error: string) => void;
  log: (verb: string, detail?: string, snapOverride?: Partial<Snapshot>) => void;
  amend: (verb: string, detail: string, snapOverride?: Partial<Snapshot>) => void;
  restore: (id: number) => boolean;
  setCamera: (cam: Cam) => void;
  setHover: (id: number | null) => void;
  setMoving: (m: boolean) => void;
};

/** What a draft starts with: nothing from scratch, or a state's things where that state had them. */
export const seedDraft = (m: Manifest | null, base: number | null): Placed[] => seedOf(m, base).map((p) => ({ ...p, key: ++placedSeq }));

/** A proposal opened as a draft: keys minted now, attempts numbered, nothing in hand. */
const inflate = (p: Proposal, id: number | null): Draft => ({
  id,
  base: p.base,
  placements: p.placements.map((x) => ({ ...x, key: ++placedSeq })),
  inHand: null,
  attempts: p.attempts.map((text, i) => ({ n: i + 1, text })),
});

/** The state the deck lands in, held inside the set: LANDING, or a shorter set's last state. */
export const landingOf = (m: Manifest | null): number => (m ? Math.min(LANDING, m.commits.length - 1) : LANDING);

/** The design's default pair for a diff: the standard against a later state, otherwise the state before this one. */
export const comparePair = (head: number, standard: number | null): [number, number] => {
  const b = head === 0 ? 1 : head;
  const a = standard !== null && head > standard ? standard : head === 0 ? 0 : head - 1;
  return [a, b];
};

const readGuide = (): { tour?: number; hints?: boolean; done?: Record<string, boolean> } => {
  try {
    return JSON.parse(sessionStorage.getItem(GUIDE_KEY) || "{}");
  } catch {
    return {};
  }
};
export const writeGuide = (s: State) => {
  try {
    sessionStorage.setItem(GUIDE_KEY, JSON.stringify({ tour: s.tour, hints: s.hints, done: s.goals }));
  } catch {
    /* private mode */
  }
};

/** The room with nothing in it, before a set's manifest lands: the engine fills it in as the set loads. */
const emptyRoom = (): Partial<State> => ({
  status: "loading",
  error: null,
  manifest: null,
  head: 0,
  mode: NORMAL,
  selected: null,
  hover: null,
  ghosts: false,
  draft: null,
  standard: null,
  loaded: [],
  loadErrors: {},
  splatCount: [],
  history: [],
  camera: null,
  camRequest: null,
  confirmStd: false,
  curtain: true, // lifted once the set's first state is in
  orbit: false,
});

/** The start state from the URL: a named preset, the bare room, or the title; ?set= opens another set. */
const initial = () => {
  const q = new URLSearchParams(location.search);
  const name = q.get("s");
  const preset = name ? PRESETS[name] : undefined;
  const skip = preset !== undefined || q.has("nointro");
  const saved = skip ? {} : readGuide();
  const draft: Draft | null = preset?.draft ? inflate(preset.draft, null) : null;
  const set = q.get("set") || DEFAULT_SET;
  const branches = readDrafts(set);
  return {
    set,
    drafts: branches.drafts,
    draftSeq: branches.seq,
    page: (preset?.page ?? (skip ? "room" : "title")) as Page,
    preset: preset ? name : null,
    head: preset?.head ?? LANDING,
    mode: preset?.mode ?? NORMAL,
    selected: preset?.selected ?? null,
    ghosts: preset?.ghosts ?? false,
    draft,
    tour: skip ? -1 : (saved.tour ?? 0),
    hints: skip ? false : (saved.hints ?? true),
    goals: saved.done ?? {},
  };
};

export const useStore = create<State>((set, get) => {
  const monthAt = (i: number) => {
    const c = get().manifest?.commits[i];
    return c ? monthOf(c.captured) : `c${i}`;
  };
  const nameOf = (id: number) => get().manifest?.objects[id]?.name ?? `object ${id}`;
  /** The patch that ticks a goal, once. */
  const done = (id: string): Partial<State> => {
    const s = get();
    if (s.goals[id]) return {};
    return { goals: { ...s.goals, [id]: true }, openGoal: s.openGoal === id ? null : s.openGoal };
  };
  const snapOf = (s: State): Snapshot => ({
    standard: s.standard,
    head: s.head,
    mode: s.mode,
    selected: s.selected,
    ghosts: s.ghosts,
    draft: s.draft,
    cam: s.liveCamera?.() ?? s.camera,
  });

  return {
    status: "loading",
    error: null,
    sites: [],
    manifest: null,
    refScale: 1,
    history: [],
    camera: null,
    liveCamera: null,
    camRequest: null,
    returnTo: "room",
    slide: 0,
    leaving: false,
    curtain: false,
    hover: null,
    loaded: [],
    loadErrors: {},
    splatCount: [],
    moving: false,
    orbit: false,
    standard: null,
    site: "",
    sitesOpen: false,
    menuOpen: false,
    confirmStd: false,
    openGoal: null,
    ...initial(),

    // ---- the deck
    nextSlide: () => {
      const s = get();
      if (s.page !== "title" || s.leaving) return;
      if (s.slide >= SLIDES.length) {
        if (s.loaded[landingOf(s.manifest)]) s.leave();
        return;
      }
      set({ slide: s.slide + 1 });
    },
    prevSlide: () => {
      const s = get();
      if (s.page !== "title" || s.leaving || s.slide === 0) return;
      set({ slide: s.slide - 1 });
    },
    leave: () => {
      const s = get();
      if (s.page !== "title" || s.leaving || !s.loaded[landingOf(s.manifest)]) return;
      set({ leaving: true });
    },
    arrive: () => {
      const s = get();
      if (s.page !== "title") return;
      const head = landingOf(s.manifest);
      const c = s.manifest?.commits[head];
      s.log("begin", c ? dateOf(c.captured) : "", { head });
      // the first arrival of a page load drifts the camera around the room; later arrivals stand still
      const orbit = !orbited;
      orbited = true;
      set({ page: "room", returnTo: "room", leaving: false, curtain: true, slide: 0, head, orbit });
    },
    liftCurtain: () => set((s) => (s.curtain ? { curtain: false } : s)),
    restartDemo: () => {
      try {
        sessionStorage.removeItem(GUIDE_KEY);
      } catch {
        /* private mode */
      }
      clearAllDrafts();
      const s = get();
      // the demo begins on the first floor: if the room shows another, its set loads again behind the deck
      const home = s.sites[0];
      const homeSet = home?.set ?? DEFAULT_SET;
      set({
        page: "title",
        returnTo: "room",
        slide: 0,
        leaving: false,
        curtain: false,
        history: [],
        goals: {},
        tour: 0,
        hints: true,
        openGoal: null,
        head: LANDING,
        mode: NORMAL,
        ghosts: false,
        draft: null,
        drafts: [],
        draftSeq: 0,
        selected: null,
        standard: s.manifest?.standard ?? s.standard,
        site: home?.id ?? s.site,
        sitesOpen: false,
        menuOpen: false,
        confirmStd: false,
        orbit: false,
        ...(homeSet !== s.set ? { ...emptyRoom(), set: homeSet, curtain: false } : {}),
      });
    },

    // ---- the room
    go: (i) => {
      const s = get();
      const M = s.manifest;
      const c = M?.commits[i];
      if (!M || !c || !s.loaded[i]) return false;
      // a draft with unsaved work holds the timeline; a clean one is left behind
      if (s.mode.kind === "draft" && s.draft && draftDirty(s.draft, s.drafts, M)) return false;
      if (s.mode.kind === "normal" && i === s.head) return true;
      const selected = carry(M.objects, s.selected, [i]);
      const patch = { head: i, mode: NORMAL, ghosts: false, selected, draft: null };
      s.log("go to", dateOf(c.captured), patch);
      set({ ...patch, ...done("move") });
      return true;
    },
    step: (d) => {
      const s = get();
      if (s.mode.kind === "compare") return;
      const n = s.manifest?.commits.length ?? 0;
      const i = Math.max(0, Math.min(n - 1, s.head + d));
      if (i !== s.head) s.go(i);
    },
    toggleCompare: () => {
      const s = get();
      const M = s.manifest;
      if (!M || s.mode.kind === "draft") return;
      if (s.mode.kind === "compare") return s.exitMode();
      const [a, b] = comparePair(s.head, s.standard);
      if (a === b || !s.loaded[a] || !s.loaded[b]) return;
      const mode: Mode = { kind: "compare", a, b, headBefore: s.head };
      const selected = carry(M.objects, s.selected, [a, b]);
      const patch = { mode, head: b, ghosts: false, selected };
      s.log("diff", `${monthAt(a)} → ${monthAt(b)}`, patch);
      set({ ...patch, ...done("diff") });
    },
    exitMode: () => {
      const s = get();
      if (s.mode.kind !== "compare") return;
      const head = s.mode.headBefore;
      const patch = { mode: NORMAL, head, selected: carry(s.manifest!.objects, s.selected, [head]) };
      s.log("done", monthAt(head), patch);
      set(patch);
    },
    toggleGhosts: () => {
      const s = get();
      if (s.standard === null || s.head === s.standard || s.mode.kind === "compare") return;
      const on = !s.ghosts;
      s.log("compare to standard", on ? "on" : "off", { ghosts: on });
      set({ ghosts: on, ...(on ? done("std") : {}) });
    },
    makeStandard: () => {
      const s = get();
      if (s.mode.kind !== "normal" || s.head === s.standard) return;
      s.log("make standard", monthAt(s.head), { standard: s.head, ghosts: false });
      set({ standard: s.head, ghosts: false });
    },
    select: (id) => {
      const s = get();
      if (s.mode.kind === "draft") return;
      const next = id === s.selected ? null : id;
      if (next !== null && !s.manifest?.objects[next]) return;
      if (next === null && s.selected === null) return;
      s.log(next === null ? "deselect" : "select", nameOf(next ?? s.selected!), { selected: next });
      set({ selected: next });
    },
    esc: () => {
      const s = get();
      if (s.page === "footnotes") return s.back();
      if (s.confirmStd) return s.cancelStandard();
      if (s.sitesOpen || s.menuOpen) return s.closeMenus();
      if (s.openGoal) return set({ openGoal: null });
      if (s.mode.kind === "draft") return s.draft?.inHand ? s.dropInHand() : s.leaveDraft();
      if (s.selected !== null) return s.select(null);
      if (s.mode.kind === "compare") return s.exitMode();
      if (s.ghosts) s.toggleGhosts();
    },
    endOrbit: () => set((s) => (s.orbit ? { orbit: false } : s)),

    // ---- a draft
    enterDraft: () => {
      const s = get();
      if (s.mode.kind !== "normal" || !s.loaded[0]) return;
      const draft: Draft = { id: null, base: s.head, placements: seedDraft(s.manifest, s.head), inHand: null, attempts: [] };
      const patch = { mode: { kind: "draft" } as Mode, selected: null, draft };
      s.log("draft", `from ${monthAt(s.head)}`, patch);
      set({ ...patch, ...done("draft") });
    },
    setDraftBase: (base) => {
      const s = get();
      if (s.mode.kind !== "draft" || !s.draft) return;
      const draft: Draft = { id: s.draft.id, base, placements: seedDraft(s.manifest, base), inHand: null, attempts: [] };
      s.log("draft", base === null ? "from scratch" : `from ${monthAt(base)}`, { draft });
      set({ draft });
    },
    pickFromTray: (id) => {
      const s = get();
      const d = s.draft;
      if (s.mode.kind !== "draft" || !d) return;
      if (d.inHand && d.inHand.id === id) {
        const draft: Draft = { ...d, inHand: null };
        s.log("remove", nameOf(id), { draft });
        return set({ draft });
      }
      const copies = d.placements.filter((p) => p.id === id).length + (d.inHand?.id === id ? 1 : 0);
      if (copies >= MAX_COPIES) return;
      const inHand: InHand = { key: ++placedSeq, id, x: 0, z: 0, at: false };
      s.log("pick", nameOf(id), { draft: { ...d, inHand } });
      set({ draft: { ...d, inHand } });
    },
    pickUpPlaced: (key) => {
      const s = get();
      const d = s.draft;
      if (s.mode.kind !== "draft" || !d || d.inHand) return;
      const p = d.placements.find((x) => x.key === key);
      if (!p) return;
      const draft: Draft = { ...d, placements: d.placements.filter((x) => x.key !== key), inHand: { ...p, at: true } };
      s.log("pick", nameOf(p.id), { draft });
      set({ draft });
    },
    moveInHand: (x, z) =>
      set((s) =>
        s.draft?.inHand && (s.draft.inHand.x !== x || s.draft.inHand.z !== z || !s.draft.inHand.at)
          ? { draft: { ...s.draft, inHand: { ...s.draft.inHand, x, z, at: true } } }
          : s,
      ),
    placeAt: (x, z) => {
      const s = get();
      const d = s.draft;
      if (!d?.inHand) return;
      const { key, id } = d.inHand;
      const draft: Draft = { ...d, placements: [...d.placements, { key, id, x, z }], inHand: null };
      s.log("place", nameOf(id), { draft });
      set({ draft });
    },
    dropInHand: () => {
      const s = get();
      const d = s.draft;
      if (!d?.inHand) return;
      const draft: Draft = { ...d, inHand: null };
      s.log("remove", nameOf(d.inHand.id), { draft });
      set({ draft });
    },
    measure: () => {
      const s = get();
      const d = s.draft;
      if (s.mode.kind !== "draft" || !d || d.placements.length === 0) return;
      const text = `${d.placements.length} placed`;
      const draft: Draft = { ...d, attempts: [...d.attempts, { n: d.attempts.length + 1, text }] };
      s.log("measure", text, { draft });
      set({ draft });
    },
    leaveDraft: () => {
      const s = get();
      if (s.mode.kind !== "draft") return;
      s.log("leave draft", draftName(s.draft?.id ?? null, s.drafts, s.draftSeq), { mode: NORMAL, draft: null });
      set({ mode: NORMAL, draft: null });
    },
    // the branches: a saved draft, kept per set in the browser and shown after the states in the timeline
    saveDraft: () => {
      const s = get();
      const d = s.draft;
      if (s.mode.kind !== "draft" || !d || !canSaveDraft(d, s.drafts, s.manifest)) return;
      const have = savedOf(s.drafts, d.id);
      const id = have?.id ?? s.draftSeq + 1;
      const entry: SavedDraft = { id, name: have?.name ?? `Draft ${id}`, savedAt: Date.now(), ...proposalOf(d) };
      const drafts = have ? s.drafts.map((x) => (x.id === id ? entry : x)) : [...s.drafts, entry];
      const draft: Draft = { ...d, id };
      s.log("save draft", entry.name, { draft });
      set({ draft, drafts, draftSeq: Math.max(s.draftSeq, id) });
    },
    openDraft: (id) => {
      const s = get();
      const entry = savedOf(s.drafts, id);
      if (!entry || !s.loaded[0] || s.mode.kind === "compare") return false;
      if (s.mode.kind === "draft" && s.draft) {
        if (s.draft.id === id) return true;
        if (draftDirty(s.draft, s.drafts, s.manifest)) return false;
      }
      const patch = { mode: { kind: "draft" } as Mode, selected: null, draft: inflate(entry, id) };
      s.log("open draft", entry.name, patch);
      set({ ...patch, ...done("draft") });
      return true;
    },
    deleteDraft: (id) => {
      const s = get();
      const entry = savedOf(s.drafts, id);
      if (!entry) return;
      const drafts = s.drafts.filter((x) => x.id !== id);
      const patch = s.mode.kind === "draft" && s.draft?.id === id ? { mode: NORMAL, draft: null } : {};
      s.log("delete draft", entry.name, patch);
      set({ ...patch, drafts });
    },

    // ---- the chrome
    toggleSites: () => set((s) => ({ sitesOpen: !s.sitesOpen, menuOpen: false })),
    closeSites: () => set((s) => (s.sitesOpen ? { sitesOpen: false } : s)),
    toggleMenu: () => set((s) => ({ menuOpen: !s.menuOpen, sitesOpen: false })),
    closeMenus: () => set((s) => (s.sitesOpen || s.menuOpen ? { sitesOpen: false, menuOpen: false } : s)),
    askStandard: () => set((s) => (s.mode.kind === "normal" && s.head !== s.standard ? { confirmStd: true } : s)),
    cancelStandard: () => set((s) => (s.confirmStd ? { confirmStd: false } : s)),
    confirmStandard: () => {
      const s = get();
      if (!s.confirmStd) return;
      set({ confirmStd: false });
      s.makeStandard();
    },
    pickSite: (id) => {
      const s = get();
      const site = s.sites.find((x) => x.id === id);
      if (!site) return;
      const tick = id !== s.site ? done("tour") : {};
      if (!site.set || site.set === s.set) return set({ site: id, sitesOpen: false, ...tick });
      // another floor: the room empties under the curtain and the engine opens its set; the log starts over there,
      // and the floor's own branches come in with it
      const branches = readDrafts(site.set);
      set({ site: id, sitesOpen: false, ...tick, ...emptyRoom(), set: site.set, drafts: branches.drafts, draftSeq: branches.seq });
    },
    openFoot: () => set((s) => (s.page === "footnotes" ? s : { page: "footnotes", menuOpen: false, returnTo: s.page })),
    back: () => set((s) => ({ page: s.returnTo || "room" })),
    tourNext: () => set((s) => (s.tour + 1 >= TOUR.length ? { tour: -1, goals: { ...s.goals, ui: true } } : { tour: s.tour + 1 })),
    tourSkip: () => set((s) => ({ tour: -1, goals: { ...s.goals, ui: true } })),
    toggleGoal: (id) => {
      const s = get();
      const g = GOALS.find((x) => x.id === id);
      if (!g || s.goals[id] || id === "ui" || s.tour >= 0) return;
      set({ openGoal: s.openGoal === id ? null : id });
    },

    // ---- bookkeeping
    setManifest: (m, refScale) =>
      set((s) => ({
        manifest: m,
        refScale,
        head: Math.min(s.head, m.commits.length - 1), // a head asked for before the set was known stays inside it
        standard: m.standard,
        sites: m.sites.length ? m.sites : s.sites,
        site: s.site || m.sites.find((x) => x.set === s.set)?.id || m.sites[0]?.id || "",
        loaded: m.commits.map(() => false),
        loadErrors: {},
        splatCount: m.commits.map(() => 0),
        drafts: fitDrafts(s.drafts, m), // a branch saved against another build of the set is trimmed to this one
      })),
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
        const snap: Snapshot = { ...snapOf(st), ...snapOverride };
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
      const { head, mode, selected, ghosts, standard, draft, cam } = a.snap;
      if (!st.loaded[head]) return false;
      if (mode.kind === "compare" && !(st.loaded[mode.a] && st.loaded[mode.b])) return false;
      // a branch deleted since the entry was written reopens as an unsaved draft
      const branch = draft && draft.id !== null && savedOf(st.drafts, draft.id) ? draft.id : null;
      const patch = { head, mode, selected, ghosts, standard, draft: draft ? { ...draft, id: branch, inHand: null } : null };
      st.log("restore", `#${String(id).padStart(2, "0")} ${a.verb}`, { ...patch, cam });
      set({ ...patch, camRequest: cam ? { cam, seq: id } : st.camRequest });
      return true;
    },
    setCamera: (camera) => set({ camera }),
    setHover: (id) => set((s) => (s.hover === id ? s : { hover: id })),
    setMoving: (moving) => set((s) => (s.moving === moving ? s : { moving })),
  };
});
