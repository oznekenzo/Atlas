/**
 * Saved drafts: branches. A draft is a layout tried on the empty floor; saved, it is kept beside the states
 * (per set, in the browser) and shown after them in the timeline. Never a state: nothing is written back to
 * the captures. Pure over the manifest and the store's Draft; the store owns the transitions.
 *
 * Placement keys are never persisted: the store mints them when a draft opens, so a saved draft is only ids
 * and positions, the same shape a `?s=` preset seeds a draft with.
 */
import type { Draft, Placed } from "./store";
import type { Manifest, Obj } from "./types";
import { centre, things } from "./scene";

/** A thing put down: which object, and where on the floor. */
export type Put = { id: number; x: number; z: number };
/** A layout proposal without identity: what a preset seeds and what a branch stores. */
export type Proposal = { base: number | null; placements: Put[]; attempts: string[] };
/** A branch: a proposal with a name, kept until deleted. `savedAt` is epoch ms. */
export type SavedDraft = Proposal & { id: number; name: string; savedAt: number };
/** What the browser holds for one set. `seq` only grows, so a name is never reused. */
export type DraftStore = { seq: number; drafts: SavedDraft[] };

export const EMPTY_STORE: DraftStore = { seq: 0, drafts: [] };
const KEY = (set: string) => `atlas.drafts.${set}`;

/** What a draft starts with: nothing from scratch, or a state's things where that state had them. */
export const seedOf = (m: Manifest | null, base: number | null): Put[] =>
  m === null || base === null
    ? []
    : m.objects
        .filter((o) => o.present.includes(base))
        .map((o) => {
          const c = centre(o);
          return { id: o.id, x: c.x, z: c.z };
        });

/** The same things in the same places, in the same order. */
export const sameLayout = (a: readonly Put[], b: readonly Put[]): boolean =>
  a.length === b.length && a.every((p, i) => p.id === b[i].id && p.x === b[i].x && p.z === b[i].z);

export const savedOf = (drafts: readonly SavedDraft[], id: number | null): SavedDraft | undefined =>
  id === null ? undefined : drafts.find((d) => d.id === id);

/** The branch's name, or the one Save would mint for a draft not yet saved. */
export const nameOf = (id: number | null, drafts: readonly SavedDraft[], seq: number): string => savedOf(drafts, id)?.name ?? `Draft ${seq + 1}`;

/**
 * Whether the draft differs from what it would revert to: its branch when saved, its seed when not. A fresh
 * draft from a state is clean, so the timeline stays live until something is actually moved.
 */
export function draftDirty(draft: Draft, drafts: readonly SavedDraft[], m: Manifest | null): boolean {
  const saved = savedOf(drafts, draft.id);
  const ref: Proposal = saved ?? { base: draft.base, placements: seedOf(m, draft.base), attempts: [] };
  return draft.base !== ref.base || draft.attempts.length !== ref.attempts.length || !sameLayout(draft.placements, ref.placements);
}

/** Save is worth offering when the draft has no branch yet, or has moved away from its branch. */
export const canSave = (draft: Draft, drafts: readonly SavedDraft[], m: Manifest | null): boolean =>
  draft.id === null || draftDirty(draft, drafts, m);

/** The branch's shape of a draft: keys dropped, attempts as their text. */
export const proposalOf = (draft: Draft): Proposal => ({
  base: draft.base,
  placements: draft.placements.map(({ id, x, z }) => ({ id, x, z })),
  attempts: draft.attempts.map((a) => a.text),
});

/** What is down, grouped by thing (an object across its states): "Tall plant × 2". */
export const placedByThing = (objects: Obj[], placements: readonly Placed[]): { name: string; n: number }[] => {
  const counts = new Map<number, number>();
  for (const p of placements) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  return things(objects)
    .map((t) => ({ name: t.name, n: t.ids.reduce((s, i) => s + (counts.get(i) ?? 0), 0) }))
    .filter((t) => t.n > 0);
};

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Whatever the browser held, or nothing: a corrupt or foreign value never reaches the store. */
export function parseDrafts(raw: unknown): DraftStore {
  if (!raw || typeof raw !== "object") return EMPTY_STORE;
  const r = raw as { seq?: unknown; drafts?: unknown };
  if (!num(r.seq) || !Array.isArray(r.drafts)) return EMPTY_STORE;
  const drafts: SavedDraft[] = [];
  for (const d of r.drafts as unknown[]) {
    if (!d || typeof d !== "object") continue;
    const x = d as Partial<SavedDraft>;
    if (!num(x.id) || typeof x.name !== "string" || !Array.isArray(x.placements) || !Array.isArray(x.attempts)) continue;
    const placements = (x.placements as unknown[]).filter((p): p is Put => {
      const q = p as Partial<Put>;
      return !!q && num(q.id) && num(q.x) && num(q.z);
    });
    drafts.push({
      id: x.id,
      name: x.name,
      base: num(x.base) ? x.base : null,
      placements: placements.map(({ id, x: px, z }) => ({ id, x: px, z })),
      attempts: (x.attempts as unknown[]).filter((a): a is string => typeof a === "string"),
      savedAt: num(x.savedAt) ? x.savedAt : 0,
    });
  }
  return { seq: Math.max(r.seq, ...drafts.map((d) => d.id)), drafts };
}

/**
 * A branch saved against another build of the set: a base past the last state becomes scratch, unknown ids are
 * dropped. Returns the same array when nothing needed fitting, so a store update is not a change.
 */
export function fitDrafts(drafts: SavedDraft[], m: Manifest): SavedDraft[] {
  let changed = false;
  const fitted = drafts.map((d) => {
    const base = d.base !== null && d.base >= m.commits.length ? null : d.base;
    const placements = d.placements.filter((p) => m.objects[p.id] !== undefined);
    if (base === d.base && placements.length === d.placements.length) return d;
    changed = true;
    return { ...d, base, placements };
  });
  return changed ? fitted : drafts;
}

export const readDrafts = (set: string): DraftStore => {
  try {
    return parseDrafts(JSON.parse(localStorage.getItem(KEY(set)) || "null"));
  } catch {
    return EMPTY_STORE;
  }
};

/** Written whenever the branches change; an empty, never-used store leaves no key behind. */
export const writeDrafts = (set: string, store: DraftStore) => {
  try {
    if (store.drafts.length === 0 && store.seq === 0) localStorage.removeItem(KEY(set));
    else localStorage.setItem(KEY(set), JSON.stringify(store));
  } catch {
    /* private mode */
  }
};

/** Restart demo: every set's branches go. */
export const clearAllDrafts = () => {
  try {
    const gone = Object.keys(localStorage).filter((k) => k.startsWith("atlas.drafts."));
    for (const k of gone) localStorage.removeItem(k);
  } catch {
    /* private mode */
  }
};
